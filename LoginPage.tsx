import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { PROFILES, type Profile } from "./auth";
import {
  LOGIN_DEPARTMENTS,
  findDepartmentProfile,
  guidedPathKeyframes,
  type DepartmentId,
} from "./departmentLogin";
import "./LoginPage.css";

interface Props {
  onLogin: (profile: Profile) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [selected, setSelected] = useState<DepartmentId | null>(null);
  const [phase, setPhase] = useState<"idle" | "moving" | "password">("idle");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const nodeRefs = useRef<
    Partial<Record<DepartmentId, HTMLButtonElement | null>>
  >({});
  const movementRef = useRef<Animation | null>(null);
  const originRef = useRef({ dx: 0, dy: 0 });
  const generationRef = useRef(0);
  const submittingRef = useRef(false);
  const department = LOGIN_DEPARTMENTS.find((item) => item.id === selected);

  useLayoutEffect(() => {
    if (phase !== "moving" || !selected) return;
    const node = nodeRefs.current[selected];
    const generation = generationRef.current;
    const arrive = () => {
      if (generationRef.current === generation) setPhase("password");
    };
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!node || reducedMotion || typeof node.animate !== "function") {
      arrive();
      return;
    }
    try {
      const animation = node.animate(
        guidedPathKeyframes(originRef.current.dx, originRef.current.dy),
        {
          duration: 880,
          easing: "cubic-bezier(.45,0,.55,1)",
        },
      );
      movementRef.current = animation;
      animation.finished.then(arrive, () => {});
      return () => {
        animation.cancel();
        if (movementRef.current === animation) movementRef.current = null;
      };
    } catch {
      arrive();
    }
  }, [phase, selected]);

  useEffect(() => {
    if (phase === "password") pwRef.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(
    () => () => {
      generationRef.current++;
      movementRef.current?.cancel();
    },
    [],
  );

  const choose = (id: DepartmentId) => {
    if (phase !== "idle") return;
    const from = nodeRefs.current[id]
      ?.querySelector(".guided-node-icon")
      ?.getBoundingClientRect();
    const to = targetRef.current?.getBoundingClientRect();
    originRef.current =
      from && to
        ? {
            dx: from.left + from.width / 2 - to.left - to.width / 2,
            dy: from.top + from.height / 2 - to.top - to.height / 2,
          }
        : { dx: 0, dy: 0 };
    generationRef.current++;
    submittingRef.current = false;
    setPassword("");
    setError("");
    setVisible(false);
    setSelected(id);
    setPhase("moving");
  };

  const reset = () => {
    const previous = selected;
    generationRef.current++;
    movementRef.current?.cancel();
    submittingRef.current = false;
    setPassword("");
    setError("");
    setVisible(false);
    setSelected(null);
    setPhase("idle");
    requestAnimationFrame(() => {
      const node = previous ? nodeRefs.current[previous] : null;
      if (node?.isConnected && !node.disabled)
        node.focus({ preventScroll: true });
    });
  };

  const submit = () => {
    if (phase !== "password" || !selected || submittingRef.current) return;
    const profile = findDepartmentProfile(PROFILES, selected, password);
    if (profile) {
      submittingRef.current = true;
      setPassword("");
      onLogin(profile);
    } else {
      setError(
        password ? "รหัสผ่านไม่ถูกต้อง" : "กรุณาใส่รหัสผ่าน",
      );
      setPassword("");
      pwRef.current?.focus({ preventScroll: true });
    }
  };

  return (
    <div className="guided-login" data-phase={phase}>
      <header className="guided-header">
        <img src="/anincolor.png" alt="ANIN" />
        <span>WORKSPACE</span>
      </header>
      <main className="guided-main">
        <div className="guided-heading">
          <span>YOUR DEPARTMENT, YOUR WORKSPACE</span>
          <h1>เลือกแผนกของคุณ</h1>
          <p>พื้นที่ทำงานสำหรับทีมของคุณ</p>
        </div>
        <div className="guided-stage">
          <div className="guided-track" aria-hidden="true" />
          <div className="guided-core">
            <img src="/anincolor.png" alt="ANIN" />
            <span>WORKSPACE HUB</span>
          </div>
          <span className="guided-target" ref={targetRef} aria-hidden="true" />
          {LOGIN_DEPARTMENTS.map((item) => (
            <button
              key={item.id}
              ref={(element) => {
                nodeRefs.current[item.id] = element;
              }}
              className={`guided-node guided-node-${item.id}${selected === item.id ? " is-selected" : ""}`}
              onClick={() => choose(item.id)}
              disabled={phase !== "idle"}
              aria-label={`เลือก${item.label}`}
              aria-pressed={selected === item.id}
              data-department={item.id}
              type="button"
            >
              <span className="guided-node-icon">
                <LoginIcon name={item.id} />
              </span>
              <span className="guided-node-label">
                <strong>{item.label}</strong>
                <small>{item.english}</small>
              </span>
            </button>
          ))}
          {phase !== "idle" && (
            <button className="guided-back" onClick={reset} type="button">
              <LoginIcon name="back" />
              เลือกแผนกใหม่
            </button>
          )}
          {phase === "password" && department && (
            <section
              className="guided-password"
              aria-labelledby="guided-department-title"
            >
              <span className="guided-department-english">
                {department.english}
              </span>
              <h2 id="guided-department-title">{department.label}</h2>
              <p>ใส่รหัสผ่าน</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
                noValidate
              >
                <label htmlFor="guided-password-input">รหัสผ่าน</label>
                <div className="guided-password-field">
                  <LoginIcon name="lock" />
                  <input
                    id="guided-password-input"
                    ref={pwRef}
                    type={visible ? "text" : "password"}
                    name="password"
                    placeholder="ใส่รหัสผ่าน"
                    value={password}
                    required
                    autoComplete="current-password"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={
                      error ? "guided-password-error" : undefined
                    }
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                  />
                  <button
                    className="guided-password-toggle"
                    type="button"
                    onClick={() => {
                      setVisible(!visible);
                      pwRef.current?.focus({ preventScroll: true });
                    }}
                    aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={visible}
                  >
                    <LoginIcon name={visible ? "eyeOff" : "eye"} />
                  </button>
                </div>
                {error && (
                  <p
                    id="guided-password-error"
                    className="guided-error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                <button className="guided-submit" type="submit">
                  เข้าสู่แผนก
                  <LoginIcon name="arrow" />
                </button>
              </form>
            </section>
          )}
        </div>
        <p className="guided-status" role="status" aria-live="polite">
          {phase === "moving"
            ? `กำลังเปิด${department?.label ?? ""}`
            : phase === "password"
              ? "Forgot password? Contact support"
              : "ANIN / WORKSPACE"}
        </p>
      </main>
    </div>
  );
}

function LoginIcon({
  name,
}: {
  name: DepartmentId | "lock" | "back" | "arrow" | "eye" | "eyeOff";
}) {
  const paths: Record<typeof name, ReactNode> = {
    sales: (
      <>
        <path d="M3 10h18M4 10v11h16V10M2 10l3-7h14l3 7M8 21v-7h8v7" />
        <path d="M2 10a3 3 0 0 0 5 2 3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 5-2" />
      </>
    ),
    purchasing: (
      <>
        <path d="M2 3h3l3 12h11l3-9H6" />
        <circle cx="9" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
      </>
    ),
    warehouse: (
      <>
        <path d="m2 8 10-6 10 6v14H2V8Z" />
        <path d="M6 22V11h12v11M6 15h12M6 19h12M9 6h6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <path d="m3 3 18 18M10 5a12 12 0 0 1 2 0c6.5 0 10 7 10 7a19 19 0 0 1-4 4M6 6a19 19 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4" />
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
