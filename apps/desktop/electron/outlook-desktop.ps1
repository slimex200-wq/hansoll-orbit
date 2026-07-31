$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Web.Extensions

function New-JsonSerializer {
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    $serializer.RecursionLimit = 100
    return $serializer
}

function Release-ComObject($value) {
    if ($null -eq $value) { return }
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value) } catch {}
}

function Get-Sha256([string]$value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($value)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Clean-Header([object]$value) {
    return ([string]$value).Replace("`r", " ").Replace("`n", " ").Trim()
}

function Read-State([string]$statePath) {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return @{ version = 2; updatedAt = $null; lastFullScanAt = $null; messages = @{} }
    }
    try {
        $serializer = New-JsonSerializer
        $json = [IO.File]::ReadAllText($statePath, [Text.Encoding]::UTF8)
        $loaded = $serializer.DeserializeObject($json)
        $messages = if ($null -ne $loaded["messages"]) { $loaded["messages"] } else { @{} }
        $updatedAt = [string]$loaded["updatedAt"]
        $lastFullScanAt = [string]$loaded["lastFullScanAt"]
        if (-not $lastFullScanAt) { $lastFullScanAt = $updatedAt }
        return @{
            version = 2
            updatedAt = $updatedAt
            lastFullScanAt = $lastFullScanAt
            messages = $messages
        }
    }
    catch {
        return @{ version = 2; updatedAt = $null; lastFullScanAt = $null; messages = @{} }
    }
}

function Write-State(
    [string]$statePath,
    [hashtable]$messages,
    [hashtable]$account,
    [string]$lastFullScanAt
) {
    $state = @{
        version = 2
        updatedAt = [DateTime]::UtcNow.ToString("o")
        lastFullScanAt = $lastFullScanAt
        account = $account
        messages = $messages
    }
    $temporaryPath = "$statePath.$PID.tmp"
    $serializer = New-JsonSerializer
    $json = $serializer.Serialize($state)
    [IO.File]::WriteAllText($temporaryPath, $json, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function Get-OutlookContext {
    $application = New-Object -ComObject Outlook.Application
    $namespace = $application.GetNamespace("MAPI")
    $accounts = $namespace.Accounts
    if ($accounts.Count -lt 1) {
        throw "Classic Outlook has no configured mail account."
    }

    $defaultStore = $null
    $account = $null
    try {
        $defaultStore = $namespace.DefaultStore
        $defaultStoreId = Clean-Header $defaultStore.StoreID
        for ($index = 1; $index -le [int]$accounts.Count; $index += 1) {
            $candidate = $null
            $deliveryStore = $null
            try {
                $candidate = $accounts.Item($index)
                $deliveryStore = $candidate.DeliveryStore
                if (
                    $defaultStoreId
                    -and (Clean-Header $deliveryStore.StoreID) -eq $defaultStoreId
                ) {
                    $account = $candidate
                    $candidate = $null
                    break
                }
            }
            finally {
                Release-ComObject $deliveryStore
                Release-ComObject $candidate
            }
        }
    }
    finally {
        Release-ComObject $defaultStore
    }
    if ($null -eq $account) {
        Release-ComObject $accounts
        Release-ComObject $namespace
        Release-ComObject $application
        throw "Classic Outlook DefaultStore is not associated with a configured mail account."
    }
    $smtpAddress = Clean-Header $account.SmtpAddress
    if (-not $smtpAddress) {
        $currentUser = $namespace.CurrentUser
        try { $smtpAddress = Clean-Header $currentUser.Address }
        finally { Release-ComObject $currentUser }
    }
    $displayName = Clean-Header $account.DisplayName
    if (-not $displayName) { $displayName = $smtpAddress }
    $profileName = Clean-Header $namespace.CurrentProfileName
    $identity = if ($smtpAddress) { $smtpAddress.ToLowerInvariant() } else { $displayName }
    $accountInfo = @{
        homeAccountId = "outlook-desktop:$profileName`:$identity"
        localAccountId = "outlook-desktop:$identity"
        tenantId = "outlook-desktop"
        username = $smtpAddress
        name = $displayName
        profileName = $profileName
    }
    Release-ComObject $account
    Release-ComObject $accounts
    return @{
        application = $application
        namespace = $namespace
        account = $accountInfo
    }
}

function Get-MailDate($item) {
    try { return [DateTime]$item.ReceivedTime } catch {}
    try { return [DateTime]$item.SentOn } catch {}
    return [DateTime]::MinValue
}

function Get-ModifiedDate($item, [DateTime]$fallback) {
    try { return [DateTime]$item.LastModificationTime } catch {}
    return $fallback
}

function Get-Sender($item) {
    $name = Clean-Header $item.SenderName
    $address = Clean-Header $item.SenderEmailAddress
    try {
        if ((Clean-Header $item.SenderEmailType) -eq "EX") {
            $sender = $item.Sender
            if ($null -ne $sender) {
                try {
                    $exchangeUser = $sender.GetExchangeUser()
                    if ($null -ne $exchangeUser) {
                        try {
                            $primary = Clean-Header $exchangeUser.PrimarySmtpAddress
                            if ($primary) { $address = $primary }
                        }
                        finally { Release-ComObject $exchangeUser }
                    }
                }
                finally { Release-ComObject $sender }
            }
        }
    }
    catch {}
    if ($name -and $address -and $name.ToLowerInvariant() -ne $address.ToLowerInvariant()) {
        return "$name <$address>"
    }
    if ($address) { return $address }
    return $name
}

function Export-MailItem(
    $item,
    [string]$folderName,
    [string]$mailbox,
    [string]$outputDirectory,
    [hashtable]$priorMessages,
    [hashtable]$nextMessages
) {
    $entryId = Clean-Header $item.EntryID
    if (-not $entryId) { return $false }
    $key = Get-Sha256 $entryId
    if ($nextMessages.ContainsKey($key)) { return $false }

    $received = Get-MailDate $item
    if ($received -eq [DateTime]::MinValue) { return $false }
    $modified = Get-ModifiedDate $item $received
    $modifiedUtc = $modified.ToUniversalTime().ToString("o")
    $fileName = "$key.txt"
    $filePath = Join-Path $outputDirectory $fileName
    $prior = if ($priorMessages.ContainsKey($key)) { $priorMessages[$key] } else { $null }
    $unchanged = $null -ne $prior -and $prior.modifiedUtc -eq $modifiedUtc -and (Test-Path -LiteralPath $filePath)

    if (-not $unchanged) {
        $subject = Clean-Header $item.Subject
        $sender = Get-Sender $item
        $to = Clean-Header $item.To
        $cc = Clean-Header $item.CC
        $body = [string]$item.Body
        $date = $received.ToUniversalTime().ToString("r", [Globalization.CultureInfo]::InvariantCulture)
        $headers = @(
            "Subject: $subject",
            "From: $sender",
            "To: $to",
            "Cc: $cc",
            "Date: $date",
            "EntryID: $entryId",
            "X-OpenCrab-Mailbox: $mailbox",
            "X-OpenCrab-Folder: $folderName",
            "X-OpenCrab-Source: outlook-desktop"
        )
        $text = ($headers -join "`r`n") + "`r`n`r`n" + $body
        $temporaryPath = "$filePath.$PID.tmp"
        [IO.File]::WriteAllText($temporaryPath, $text, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryPath -Destination $filePath -Force
    }

    $nextMessages[$key] = @{
        fileName = $fileName
        modifiedUtc = $modifiedUtc
        receivedUtc = $received.ToUniversalTime().ToString("o")
        folder = $folderName
    }
    return (-not $unchanged)
}

function Sync-OutlookMail($request, $context) {
    $outputDirectory = [IO.Path]::GetFullPath([string]$request.outputDirectory)
    $accountDirectory = [IO.Path]::GetFullPath([string]$request.accountDirectory)
    $lookbackDays = [Math]::Min(730, [Math]::Max(7, [int]$request.lookbackDays))
    $maxItems = [Math]::Min(50000, [Math]::Max(100, [int]$request.maxItems))
    $newOutlookRunning = @(Get-Process -Name "olk" -ErrorAction SilentlyContinue).Count -gt 0
    $serverRefreshOk = $true
    $serverRefreshError = ""
    try {
        [void]$context.namespace.SendAndReceive($false)
        Start-Sleep -Milliseconds 1500
    }
    catch {
        $serverRefreshOk = $false
        $serverRefreshError = Clean-Header $_.Exception.Message
    }
    $sourceIsAuthoritative = $serverRefreshOk -and (-not $newOutlookRunning)
    $sourceWarning = if ($newOutlookRunning) {
        "New Outlook is running. Classic Outlook local data may not include the Microsoft 365 mailbox used by New Outlook."
    }
    elseif (-not $serverRefreshOk) {
        "Classic Outlook could not refresh from Microsoft 365: $serverRefreshError"
    }
    else { "" }
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($accountDirectory) | Out-Null
    $statePath = Join-Path $accountDirectory "outlook-sync-state.json"
    $priorState = Read-State $statePath
    $priorMessages = $priorState.messages
    $nextMessages = @{}
    $lastFullScanAt = [string]$priorState.lastFullScanAt
    $lastFullScan = [DateTime]::MinValue
    try {
        if ($lastFullScanAt) { $lastFullScan = [DateTime]::Parse($lastFullScanAt).ToUniversalTime() }
    }
    catch { $lastFullScan = [DateTime]::MinValue }
    $fastScan = $priorMessages.Count -gt 0 -and $lastFullScan -gt [DateTime]::UtcNow.AddHours(-24)
    $scanMode = if ($fastScan) { "incremental" } else { "full" }
    $unchangedStopCount = 25
    $cutoff = (Get-Date).AddDays(-$lookbackDays)
    $excludedFolders = @{
        "deleted items" = $true; "junk email" = $true; "drafts" = $true;
        "outbox" = $true; "sync issues" = $true; "conversation history" = $true
    }
    $excludedFolderIds = @{}
    foreach ($defaultFolderType in @(3, 4, 16, 20, 23)) {
        $excludedFolder = $null
        try {
            $excludedFolder = $context.namespace.GetDefaultFolder($defaultFolderType)
            $excludedFolderId = Clean-Header $excludedFolder.EntryID
            if ($excludedFolderId) { $excludedFolderIds[$excludedFolderId] = $true }
        }
        catch {}
        finally { Release-ComObject $excludedFolder }
    }
    $seenFolders = @{}
    $script:changed = 0
    $script:processed = 0
    $script:newEntries = 0
    $script:folderCount = 0
    $script:folderErrors = @()
    $script:truncated = $false

    function Sync-Folder($folder, [int]$depth) {
        if ($null -eq $folder -or $depth -gt 8 -or $script:truncated) { return }
        $folderEntryId = Clean-Header $folder.EntryID
        if ($folderEntryId -and $seenFolders.ContainsKey($folderEntryId)) { return }
        if ($folderEntryId) { $seenFolders[$folderEntryId] = $true }
        if ($folderEntryId -and $excludedFolderIds.ContainsKey($folderEntryId)) { return }
        $folderName = Clean-Header $folder.Name
        if ($excludedFolders.ContainsKey($folderName.ToLowerInvariant())) { return }
        try {
            if ([int]$folder.DefaultItemType -ne 0) { return }
        }
        catch {}
        $script:folderCount += 1

        $items = $null
        try {
            $items = $folder.Items
            try { $items.Sort("[ReceivedTime]", $true) } catch {}
            $itemCount = [int]$items.Count
            $consecutiveUnchanged = 0
            for ($index = 1; $index -le $itemCount; $index += 1) {
                $item = $null
                try {
                    $item = $items.Item($index)
                    if ($null -eq $item -or [int]$item.Class -ne 43) { continue }
                    $received = Get-MailDate $item
                    if ($received -eq [DateTime]::MinValue) { continue }
                    if ($received -lt $cutoff) { break }
                    $entryId = Clean-Header $item.EntryID
                    if (-not $entryId) { continue }
                    $entryKey = Get-Sha256 $entryId
                    $isNewEntry = -not $priorMessages.ContainsKey($entryKey)
                    if ($isNewEntry -and $script:newEntries -ge $maxItems) {
                        $script:truncated = $true
                        break
                    }
                    $script:processed += 1
                    $wasChanged = Export-MailItem $item $folderName $context.account.username $outputDirectory $priorMessages $nextMessages
                    if ($wasChanged) {
                        $script:changed += 1
                        $consecutiveUnchanged = 0
                    }
                    elseif ($priorMessages.ContainsKey($entryKey)) {
                        $consecutiveUnchanged += 1
                        if ($fastScan -and $consecutiveUnchanged -ge $unchangedStopCount) { break }
                    }
                    else {
                        $consecutiveUnchanged = 0
                    }
                    if ($isNewEntry) { $script:newEntries += 1 }
                }
                catch {
                    $script:folderErrors += "$folderName item $index`: $($_.Exception.Message)"
                }
                finally { Release-ComObject $item }
            }
        }
        catch {
            $script:folderErrors += "$folderName`: $($_.Exception.Message)"
        }
        finally { Release-ComObject $items }

        if (-not $script:truncated) {
            $folders = $null
            try {
                $folders = $folder.Folders
                for ($childIndex = 1; $childIndex -le [int]$folders.Count; $childIndex += 1) {
                    $child = $null
                    try {
                        $child = $folders.Item($childIndex)
                        Sync-Folder $child ($depth + 1)
                    }
                    finally { Release-ComObject $child }
                }
            }
            catch {
                $script:folderErrors += "$folderName subfolders: $($_.Exception.Message)"
            }
            finally { Release-ComObject $folders }
        }
    }

    $defaultStore = $null
    $rootFolder = $null
    $rootFolders = $null
    try {
        $defaultStore = $context.namespace.DefaultStore
        $rootFolder = $defaultStore.GetRootFolder()
        $rootFolders = $rootFolder.Folders
        for ($rootIndex = 1; $rootIndex -le [int]$rootFolders.Count; $rootIndex += 1) {
            $folder = $null
            try {
                $folder = $rootFolders.Item($rootIndex)
                Sync-Folder $folder 0
            }
            finally { Release-ComObject $folder }
        }
    }
    finally {
        Release-ComObject $rootFolders
        Release-ComObject $rootFolder
        Release-ComObject $defaultStore
    }

    $removed = 0
    $complete = (-not $fastScan) -and (-not $script:truncated) -and $script:folderErrors.Count -eq 0
    if ($complete) {
        foreach ($key in @($priorMessages.Keys)) {
            if ($nextMessages.ContainsKey($key)) { continue }
            $prior = $priorMessages[$key]
            if ($null -ne $prior.fileName) {
                $priorPath = Join-Path $outputDirectory ([string]$prior.fileName)
                if (Test-Path -LiteralPath $priorPath -PathType Leaf) {
                    Remove-Item -LiteralPath $priorPath -Force
                }
            }
            $removed += 1
        }
    }
    else {
        foreach ($key in @($priorMessages.Keys)) {
            if (-not $nextMessages.ContainsKey($key)) { $nextMessages[$key] = $priorMessages[$key] }
        }
    }

    if ($complete) { $lastFullScanAt = [DateTime]::UtcNow.ToString("o") }
    Write-State $statePath $nextMessages $context.account $lastFullScanAt
    $ok = $script:folderErrors.Count -eq 0
    return @{
        available = $true
        state = "connected"
        account = $context.account
        exportDirectory = $outputDirectory
        syncedAt = [DateTime]::UtcNow.ToString("o")
        changed = $script:changed
        removed = $removed
        totalMessages = $nextMessages.Count
        truncated = $script:truncated
        scanMode = $scanMode
        sourceCoverage = if ($sourceIsAuthoritative) { "mailbox_refreshed" } else { "local_cache_only" }
        sourceWarning = $sourceWarning
        newOutlookRunning = $newOutlookRunning
        serverRefreshOk = $serverRefreshOk
        results = @(@{
            mailbox = $context.account.username
            shared = $false
            ok = $ok
            folderCount = $script:folderCount
            changed = $script:changed
            removed = $removed
            totalMessages = $nextMessages.Count
            error = if (-not $ok) {
                ($script:folderErrors | Select-Object -First 3) -join " / "
            }
            elseif (-not $sourceIsAuthoritative) {
                $sourceWarning
            }
            else { "" }
        })
    }
}

function Open-OutlookMail($request, $context) {
    $entryId = Clean-Header $request.entryId
    $subject = Clean-Header $request.subject
    $receivedText = Clean-Header $request.received

    if ($entryId) {
        $item = $null
        try {
            $item = $context.namespace.GetItemFromID($entryId)
            if ($null -ne $item) {
                $item.Display()
                return @{
                    available = $true
                    state = "opened"
                    account = $context.account
                    method = "entry_id"
                }
            }
        }
        catch {}
        finally { Release-ComObject $item }
    }

    if (-not $subject) {
        throw "Mail subject is required when EntryID is unavailable."
    }

    $received = $null
    try {
        if ($receivedText) { $received = [DateTime]::Parse($receivedText).ToUniversalTime() }
    }
    catch { $received = $null }
    $cutoff = (Get-Date).AddDays(-730)
    $bestItem = $null
    $bestDelta = [double]::MaxValue
    $folders = @()
    try {
        $folders += $context.namespace.GetDefaultFolder(6)
        $folders += $context.namespace.GetDefaultFolder(5)
        foreach ($folder in $folders) {
            $items = $null
            try {
                $items = $folder.Items
                try { $items.Sort("[ReceivedTime]", $true) } catch {}
                $count = [Math]::Min([int]$items.Count, 200)
                for ($index = 1; $index -le $count; $index += 1) {
                    $item = $null
                    try {
                        $item = $items.Item($index)
                        if ($null -eq $item -or [int]$item.Class -ne 43) { continue }
                        $itemSubject = Clean-Header $item.Subject
                        if ($itemSubject.ToLowerInvariant() -ne $subject.ToLowerInvariant()) { continue }
                        $itemDate = Get-MailDate $item
                        if ($itemDate -lt $cutoff) { break }
                        if ($null -eq $received) {
                            $item.Display()
                            return @{
                                available = $true
                                state = "opened"
                                account = $context.account
                                method = "subject"
                            }
                        }
                        $delta = [Math]::Abs(($itemDate.ToUniversalTime() - $received).TotalSeconds)
                        if ($delta -lt $bestDelta) {
                            if ($null -ne $bestItem) { Release-ComObject $bestItem }
                            $bestItem = $item
                            $item = $null
                            $bestDelta = $delta
                        }
                    }
                    finally { Release-ComObject $item }
                }
            }
            finally { Release-ComObject $items }
        }
        if ($null -ne $bestItem) {
            $bestItem.Display()
            return @{
                available = $true
                state = "opened"
                account = $context.account
                method = "subject_received"
            }
        }
    }
    finally {
        Release-ComObject $bestItem
        foreach ($folder in $folders) { Release-ComObject $folder }
    }
    throw "Classic Outlook could not find the requested mail by subject."
}

$context = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw.Trim()) { throw "Outlook connector request is empty." }
    $request = $raw | ConvertFrom-Json
    $context = Get-OutlookContext
    if ($request.operation -eq "probe") {
        $inbox = $null
        try {
            $inbox = $context.namespace.GetDefaultFolder(6)
            $result = @{
                available = $true
                state = "connected"
                account = $context.account
                profileName = $context.account.profileName
                inboxItems = [int]$inbox.Items.Count
                newOutlookRunning = @(Get-Process -Name "olk" -ErrorAction SilentlyContinue).Count -gt 0
            }
        }
        finally { Release-ComObject $inbox }
    }
    elseif ($request.operation -eq "sync") {
        $result = Sync-OutlookMail $request $context
    }
    elseif ($request.operation -eq "open") {
        $result = Open-OutlookMail $request $context
    }
    else {
        throw "Unsupported Outlook connector operation: $($request.operation)"
    }
    $result | ConvertTo-Json -Depth 8 -Compress
}
catch {
    @{
        available = $false
        state = "unavailable"
        account = $null
        error = $_.Exception.Message
    } | ConvertTo-Json -Depth 6 -Compress
}
finally {
    if ($null -ne $context) {
        Release-ComObject $context.namespace
        Release-ComObject $context.application
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
