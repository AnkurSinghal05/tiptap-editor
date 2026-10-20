import { MdCheck } from "react-icons/md";

export interface StepInfo<K extends string> {
  key: K;
  title: string;
  detail: string;
}

interface StepperProps<K extends string> {
  steps: StepInfo<K>[];
  current: K;
  canGoTo: (key: K) => boolean;
  onGoTo: (key: K) => void;
}

// The create flow's steps. Earlier steps (and later ones already reached) can
// be revisited by clicking them.
export const Stepper = <K extends string>({ steps, current, canGoTo, onGoTo }: StepperProps<K>) => {
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
    <ol className="stepper">
      {steps.map((step, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        const body = (
          <>
            <span className="stepper__marker">{state === "done" ? <MdCheck aria-hidden /> : i + 1}</span>
            <span className="stepper__text">
              <span className="stepper__title">{step.title}</span>
              <span className="stepper__detail">{step.detail}</span>
            </span>
          </>
        );
        return (
          <li key={step.key} className={`stepper__step stepper__step--${state}`} aria-current={state === "current" ? "step" : undefined}>
            {state !== "current" && canGoTo(step.key) ? (
              <button type="button" className="stepper__button" onClick={() => onGoTo(step.key)}>
                {body}
              </button>
            ) : (
              <span className="stepper__button">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
};
