import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const easeOut = [0.16, 1, 0.3, 1] as const;

export function ViewTransition({ viewKey, children }: { viewKey: string; children: ReactNode }) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="view-transition"
        exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -3 }}
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 5 }}
        key={viewKey}
        transition={{ duration: reducedMotion ? 0 : 0.2, ease: easeOut }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function MotionNumber({ value, className = "" }: { value: number; className?: string }) {
  const reducedMotion = useReducedMotion();

  return (
    <span aria-label={String(value)} className={`motion-number ${className}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          aria-hidden="true"
          exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -7 }}
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 7 }}
          key={value}
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: easeOut }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ShimmerText({ active, children }: { active: boolean; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  return (
    <span className={active && !reducedMotion ? "motion-shimmer" : undefined}>
      {children}
    </span>
  );
}

export function MotionTabIndicator({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      className="motion-tab-indicator"
      layoutId={layoutId}
      transition={{ duration: 0.22, ease: easeOut }}
    />
  );
}

export function AgentExecutionPulse() {
  const reducedMotion = useReducedMotion();
  const steps = [
    { label: "요청 확인", state: "done" },
    { label: "근거 확인 · 실행안 정리", state: "active" },
    { label: "답변 준비", state: "queued" },
  ] as const;

  return (
    <section aria-label="Work Agent 실행 단계" className="agent-execution-pulse" role="status">
      <div className="agent-execution-heading">
        <strong>Work Agent 실행 중</strong>
        <ShimmerText active>업무 근거를 확인하고 있습니다</ShimmerText>
      </div>
      <ol>
        {steps.map((step, index) => (
          <motion.li
            animate={{ opacity: step.state === "queued" ? 0.58 : 1, x: 0 }}
            className={step.state}
            initial={reducedMotion ? false : { opacity: 0, x: 4 }}
            key={step.label}
            transition={{ delay: reducedMotion ? 0 : index * 0.05, duration: 0.2, ease: easeOut }}
          >
            <span aria-hidden="true" className="agent-execution-node">
              {step.state === "done" ? <Check size={10} strokeWidth={3} /> : index + 1}
            </span>
            <span>{step.label}</span>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
