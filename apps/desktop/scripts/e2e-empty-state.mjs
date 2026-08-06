import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDirectory = path.join(repoRoot, "outputs", "desktop-e2e-empty-state");
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-empty-e2e-"));
fs.mkdirSync(outputDirectory, { recursive: true });

const packagedExecutable = process.env.ORBIT_E2E_EXECUTABLE || "";
const application = await electron.launch({
  ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
  args: packagedExecutable
    ? [`--user-data-dir=${userDataDirectory}`]
    : [".", `--user-data-dir=${userDataDirectory}`],
  cwd: desktopRoot,
  env: {
    ...process.env,
    OPENCRAB_E2E_MODE: "1",
    OPENCRAB_E2E_EMPTY_STATE: "1",
    OPENCRAB_DESKTOP_CONFIG_PATH: path.join(userDataDirectory, "no-microsoft-config.json"),
  },
});

const window = await application.firstWindow();
window.setDefaultTimeout(45_000);
const errors = [];
window.on("pageerror", (error) => errors.push(error.message));
window.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

const inspectSuggestionReadability = async (theme) =>
  window.evaluate((selectedTheme) => {
    document.documentElement.dataset.theme = selectedTheme;
    const button = document.querySelector(".agent-suggestions button");
    if (!(button instanceof HTMLElement)) return null;
    const parse = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    const foreground = parse(getComputedStyle(button).color);
    const background = parse(getComputedStyle(document.querySelector(".agent-panel")).backgroundColor);
    const luminance = (channels) => {
      const values = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return {
      contrast:
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      fontSize: Number.parseFloat(getComputedStyle(button).fontSize),
    };
  }, theme);

try {
  await window.getByRole("heading", { name: "업무 현황" }).waitFor({ timeout: 120_000 });
  // Synthetic data must never be indistinguishable from real work. Any mode
  // that seeds fixtures has to declare itself in the badge and window title.
  // Compact Windows runners intentionally hide the secondary title-bar label,
  // so verify the synthetic-data marker is mounted instead of requiring it to
  // remain visually exposed at every responsive width.
  await window
    .getByTestId("desktop-titlebar")
    .getByText("IT 검토용", { exact: true })
    .waitFor({ state: "attached", timeout: 30_000 });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getTitle(),
    ),
    "HANSOLL ORBIT · IT 검토용",
    "A synthetic-data run must be labelled in the window title.",
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized(),
    ),
    true,
    "Packaged window should open maximized.",
  );
  await window.getByTestId("window-size-toggle").dblclick();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized(),
    ),
    false,
    "Packaged title-bar double-click should restore the window.",
  );
  await window.getByTestId("window-size-toggle").dblclick();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized(),
    ),
    true,
    "Packaged title-bar double-click should maximize the window.",
  );
  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    target.unmaximize();
    // Stay below the responsive breakpoint without requesting the runner's
    // entire work area; Windows constrains a 1024x768 content window when the
    // taskbar or display scaling reduces the available desktop height.
    target.setContentSize(1024, 720);
    target.center();
  });
  await window.waitForFunction(
    () => window.innerWidth === 1024 && window.innerHeight >= 640 && window.innerHeight <= 720,
  );
  for (const theme of ["dark", "dracula"]) {
    const readability = await inspectSuggestionReadability(theme);
    assert.ok(readability, `${theme} Agent suggestions were not rendered.`);
    assert.ok(
      readability.contrast >= 4.5,
      `${theme} Agent suggestion contrast is too low: ${JSON.stringify(readability)}`,
    );
    assert.ok(
      readability.fontSize >= 12,
      `${theme} Agent suggestion font is too small: ${JSON.stringify(readability)}`,
    );
    await window.screenshot({
      path: path.join(outputDirectory, `agent-suggestions-${theme}-1024.png`),
      fullPage: true,
    });
  }
  await window.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const closeAgent = window.getByRole("button", { name: "Work Agent 닫기" });
  if (await closeAgent.isVisible()) await closeAgent.click();
  assert.deepEqual(
    await window.evaluate(() => window.opencrab.getState()),
    {
      schemaVersion: 6,
      cases: [],
      tasks: [],
      milestones: [],
      decisions: [],
      artifactJobs: [],
      auditEvents: [],
    },
    "Empty-profile E2E was unexpectedly seeded.",
  );

  await window.getByRole("button", { name: "업무 플래너", exact: true }).click();
  await window.getByRole("button", { name: "할 일 추가", exact: true }).click();
  const compactTaskForm = await window.locator(".planner-create-form").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(
    compactTaskForm.scrollWidth <= compactTaskForm.clientWidth,
    `Compact new-task form overflows: ${JSON.stringify(compactTaskForm)}`,
  );
  await window.getByLabel("새 업무 건 이름").fill("271900010 메일 Follow-up");
  await window.getByPlaceholder("할 일").fill("오늘 회신 초안 준비");
  await window.getByRole("button", { name: "저장", exact: true }).click();
  await window.getByText("오늘 회신 초안 준비", { exact: true }).waitFor();

  await window.getByRole("button", { name: "일정 추가", exact: true }).click();
  await window.getByLabel("업무 건", { exact: true }).selectOption("");
  await window.getByLabel("새 업무 건 이름").fill("271900013 GAC 일정");
  await window.getByLabel("일정 종류").selectOption("GAC");
  await window.getByLabel("예정일").fill("2026-08-10");
  await window.getByRole("button", { name: "저장", exact: true }).click();
  await window.getByText("271900013 GAC 일정", { exact: true }).waitFor();
  await window.getByRole("tab", { name: "월간" }).click();
  const compactMonth = await window.locator(".planner-month-calendar").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(compactMonth.scrollWidth <= compactMonth.clientWidth, `Compact month calendar overflows: ${JSON.stringify(compactMonth)}`);
  await window.screenshot({ path: path.join(outputDirectory, "planner-month-1024.png"), fullPage: true });
  await window.getByRole("tab", { name: "연간" }).click();
  assert.equal(await window.locator(".planner-year-month").count(), 12);
  const compactYear = await window.locator(".planner-year-grid").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(compactYear.scrollWidth <= compactYear.clientWidth, `Compact year calendar overflows: ${JSON.stringify(compactYear)}`);
  await window.screenshot({ path: path.join(outputDirectory, "planner-year-1024.png"), fullPage: true });

  await window.getByRole("button", { name: "결정·인수인계", exact: true }).click();
  await window.getByRole("button", { name: "결정 기록", exact: true }).click();
  await window.getByLabel("업무 건", { exact: true }).selectOption("");
  await window.getByLabel("새 업무 건 이름").fill("271900030 Submit 인수인계");
  await window.getByPlaceholder("판단이 필요했던 항목").fill("다음 Submit 담당자");
  await window.getByLabel("결정", { exact: true }).fill("Development 담당자가 다음 Submit을 진행합니다.");
  await window.getByLabel("채택한 근거").fill("최신 메일의 담당자 지정");
  await window.getByLabel("영향·인수인계").fill("Development 담당자가 다음 Submit 일정과 산출물을 이어서 처리");
  await window.getByRole("button", { name: "기록 저장", exact: true }).click();
  await window.getByRole("heading", { name: "다음 Submit 담당자" }).waitFor();

  await window.getByRole("button", { name: "산출물", exact: true }).click();
  await window.getByRole("button", { name: "양식 작업", exact: true }).click();
  await window.getByLabel("업무 건").selectOption("");
  await window.getByLabel("새 업무 건 이름").fill("271900050 Solid Submit");
  await window.getByPlaceholder("발송 단계와 Style 포함").fill("271900050 Solid Submit Form");
  await window.waitForFunction(
    () => Boolean(document.querySelector('input[aria-label="자동 연결된 회사 원본"]')?.value),
  );
  await window.screenshot({
    path: path.join(outputDirectory, "artifact-form-light-1024.png"),
    fullPage: true,
  });
  await window.getByRole("button", { name: "작업 등록", exact: true }).click();
  await window.getByText("271900050 Solid Submit Form", { exact: true }).waitFor();

  const state = await window.evaluate(() => window.opencrab.getState());
  assert.equal(state.cases.length, 4);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.milestones.length, 1);
  assert.equal(state.decisions.length, 1);
  assert.equal(state.artifactJobs.length, 1);
  assert.ok(state.tasks.every((item) => state.cases.some((workCase) => workCase.id === item.caseId)));
  assert.ok(state.milestones.every((item) => state.cases.some((workCase) => workCase.id === item.caseId)));
  assert.ok(state.decisions.every((item) => state.cases.some((workCase) => workCase.id === item.caseId)));
  assert.ok(state.artifactJobs.every((item) => state.cases.some((workCase) => workCase.id === item.caseId)));
  const dimensions = await window.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(
    dimensions.bodyWidth <= dimensions.viewportWidth,
    `Empty-profile workflow overflows at minimum width: ${JSON.stringify(dimensions)}`,
  );

  await window.screenshot({
    path: path.join(outputDirectory, "empty-profile-four-workflows.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join("\n")}`);
  console.log(JSON.stringify({ status: "PASS", cases: state.cases.length, outputDirectory }, null, 2));
} finally {
  await application.close();
}
