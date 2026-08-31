import type { ReactNode } from "react";
import type { Application, Job, Status } from "./types";

const Shield = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ShieldOff = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M3 3l18 18" />
  </svg>
);

const Check = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function Header({
  webmcp,
  polyfilled,
  protection,
  onProtection,
  widgetLoaded,
  onWidget,
  simOpen,
  onSim,
}: {
  webmcp: boolean;
  polyfilled: boolean;
  protection: boolean;
  onProtection: (next: boolean) => void;
  widgetLoaded: boolean;
  onWidget: (next: boolean) => void;
  simOpen: boolean;
  onSim: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">JB</div>
        <div>
          <div className="brand-name">JamBoard Jobs</div>
          <div className="brand-sub">agent-ready job board</div>
        </div>
      </div>

      <div className="header-tools">
        <span
          className={`pill ${webmcp ? "live" : "absent"}`}
          title={
            polyfilled
              ? "A demo polyfill is standing in for the browser's WebMCP — not the real API"
              : "document.modelContext"
          }
        >
          <span className="dot" />
          {!webmcp ? "WebMCP unavailable" : polyfilled ? "WebMCP (polyfill)" : "WebMCP live"}
        </span>

        <button
          className={`ghost-btn ${widgetLoaded ? "active" : ""}`}
          onClick={() => onWidget(!widgetLoaded)}
          title="Registers finalize_application straight at document.modelContext, bypassing Grenz's own API"
        >
          {widgetLoaded ? "✓ Third-party widget" : "Load third-party widget"}
        </button>

        <button className={`ghost-btn ${simOpen ? "active" : ""}`} onClick={onSim}>
          Simulator
        </button>

        <button
          className={`shield-toggle ${protection ? "" : "off"}`}
          onClick={() => onProtection(!protection)}
          aria-pressed={protection}
        >
          {protection ? <Shield /> : <ShieldOff />}
          Grenz {protection ? "ON" : "OFF"}
          <span className="switch" />
        </button>
      </div>
    </header>
  );
}

export function Banner({ kind, children }: { kind: "info" | "danger"; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "danger" ? "alert" : undefined}>
      {kind === "danger" ? <ShieldOff size={14} /> : null}
      <span>{children}</span>
    </div>
  );
}

export function JobList({
  jobs,
  total,
  query,
  onQuery,
  selectedId,
  apps,
  onSelect,
}: {
  jobs: Job[];
  total: number;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  apps: Record<string, Application>;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="list-head">
        <input
          className="search"
          placeholder="Search roles, companies, tags…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Search jobs"
        />
        <div className="list-meta">
          {jobs.length === total
            ? `${total} open roles`
            : `${jobs.length} of ${total} roles match “${query}”`}
        </div>
      </div>

      <div className="col-scroll">
        {jobs.length === 0 ? (
          <div className="empty-detail" style={{ height: "auto", padding: "48px 24px" }}>
            <div className="inner">
              <h2>No matches</h2>
              <p>
                Nothing matches “{query}”. Clear the search to see all {total} roles.
              </p>
            </div>
          </div>
        ) : (
          jobs.map((job) => (
            <button
              key={job.id}
              className={`job-card ${job.id === selectedId ? "selected" : ""}`}
              onClick={() => onSelect(job.id)}
            >
              <div className="job-card-top">
                <h3>{job.title}</h3>
                {apps[job.id] && (
                  <span className={`status ${apps[job.id]!.status}`}>{apps[job.id]!.status}</span>
                )}
              </div>
              <div className="co">{job.company}</div>
              <div className="meta">
                <span>{job.location}</span>
                <span>·</span>
                <span>{job.salary}</span>
                <span>·</span>
                <span>{job.posted}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}

export function JobDetail({ job }: { job: Job }) {
  return (
    <>
      <h1>{job.title}</h1>
      <div className="co-line">
        {job.company} · {job.location}
      </div>
      <div className="facts">
        <span className="fact">{job.salary}</span>
        <span className="fact">Posted {job.posted}</span>
        {job.tags.map((t) => (
          <span key={t} className="fact tag">
            {t}
          </span>
        ))}
      </div>
      <div className="body">{job.description}</div>
    </>
  );
}

const MAX_COVER = 4000;

export function ApplyPanel({
  job,
  draft,
  status,
  onDraft,
  onSaveDraft,
  onSubmit,
  onWithdraw,
}: {
  job: Job;
  draft: string;
  status: Status | undefined;
  onDraft: (text: string) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onWithdraw: () => void;
}) {
  if (status === "submitted") {
    return (
      <div className="apply-panel">
        <div className="apply-head">
          <h2>Your application</h2>
        </div>
        <div className="apply-body">
          <div className="submitted-note">
            <Check />
            Submitted to {job.company}.
          </div>
          <div className="apply-actions">
            <button className="btn btn-secondary" onClick={onWithdraw}>
              Withdraw application
            </button>
          </div>
        </div>
      </div>
    );
  }

  const over = draft.length > MAX_COVER;

  return (
    <div className="apply-panel">
      <div className="apply-head">
        <h2>Apply to {job.company}</h2>
      </div>
      <div className="apply-body">
        <label htmlFor="cover">Cover letter</label>
        <textarea
          id="cover"
          className="cover"
          value={draft}
          placeholder="Write your cover letter, or ask the agent to draft one…"
          onChange={(e) => onDraft(e.target.value)}
        />
        <div className="apply-actions">
          <button className="btn btn-secondary" onClick={onSaveDraft} disabled={!draft.trim()}>
            Save draft
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={draft.trim().length < 40 || over}
          >
            Submit application
          </button>
          <span className={`count ${over ? "over" : ""}`}>
            {draft.length.toLocaleString()} / {MAX_COVER.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

export function EmptyDetail() {
  return (
    <div className="empty-detail">
      <div className="inner">
        <h2>Pick a role</h2>
        <p>Choose a posting on the left, or ask your agent to search for one.</p>
      </div>
    </div>
  );
}

export function ApplicationsList({
  jobs,
  apps,
  selectedId,
  onSelect,
}: {
  jobs: Job[];
  apps: Record<string, Application>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Submitted first, then drafts — the ones with consequences at the top.
  const rows = Object.values(apps).sort((a, b) =>
    a.status === b.status ? a.jobId.localeCompare(b.jobId) : a.status === "submitted" ? -1 : 1,
  );

  if (rows.length === 0) {
    return (
      <div className="col-scroll">
        <div className="empty-detail" style={{ height: "auto", padding: "48px 24px" }}>
          <div className="inner">
            <h2>No applications yet</h2>
            <p>
              Save a draft or submit an application and it will show up here. Your agent can read
              this list back with <code>list_applications</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="col-scroll">
      {rows.map((a) => {
        const job = jobs.find((j) => j.id === a.jobId);
        return (
          <button
            key={a.jobId}
            className={`job-card ${a.jobId === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(a.jobId)}
          >
            <div className="job-card-top">
              <h3>{job?.title ?? a.jobId}</h3>
              <span className={`status ${a.status}`}>{a.status}</span>
            </div>
            <div className="co">{job?.company ?? "unknown"}</div>
            <div className="meta">
              <span>
                {a.coverLetter.length.toLocaleString()} character
                {a.coverLetter.length === 1 ? "" : "s"}
              </span>
              {a.submittedAt && (
                <>
                  <span>·</span>
                  <span>sent {new Date(a.submittedAt).toLocaleTimeString()}</span>
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
