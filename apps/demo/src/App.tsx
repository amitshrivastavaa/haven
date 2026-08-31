import { useCallback, useEffect, useMemo, useState } from "react";
import { GrenzTimeline, useGrenzTool } from "grenz-webmcp/react";
import { g } from "./grenz-instance";
import jobsData from "./jobs.json";
import { Simulator } from "./Simulator";
import {
  ApplicationsList,
  ApplyPanel,
  Banner,
  EmptyDetail,
  Header,
  JobDetail,
  JobList,
} from "./components";
import { loadThirdPartyWidget, unloadThirdPartyWidget } from "./widget";
import type { Application, Job } from "./types";

const jobs = jobsData as Job[];

function hasWebMCP(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean((document as any).modelContext ?? (navigator as any).modelContext);
}

/** The card an agent gets back from a search — the posting minus its body. */
function summarise({ description: _d, ...rest }: Job) {
  return rest;
}

export function App() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"jobs" | "applications">("jobs");
  const [selectedId, setSelectedId] = useState<string | null>(jobs[0]?.id ?? null);
  const [apps, setApps] = useState<Record<string, Application>>({});
  const [protection, setProtection] = useState(true);
  const [widgetLoaded, setWidgetLoaded] = useState(false);
  const [breach, setBreach] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(() => new URLSearchParams(location.search).has("sim"));

  const webmcp = useMemo(hasWebMCP, []);
  const polyfilled = useMemo(() => Boolean((window as any).__grenzPolyfilled), []);

  // No native WebMCP? The simulator is the way in, so open it unprompted
  // rather than leaving the visitor on a page with nothing to click.
  useEffect(() => {
    if (!webmcp) setSimOpen(true);
  }, [webmcp]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.title, j.company, j.location, j.summary, ...j.tags].join(" ").toLowerCase().includes(q),
    );
  }, [query]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  const upsert = useCallback((jobId: string, patch: Partial<Application>) => {
    setApps((prev) => {
      const existing = prev[jobId] ?? { jobId, status: "draft" as const, coverLetter: "" };
      return { ...prev, [jobId]: { ...existing, ...patch } };
    });
  }, []);

  // --- the tools the agent sees -------------------------------------------
  //
  // Each one is an ordinary function that also moves the UI, so an observer
  // can watch the agent work rather than take the timeline's word for it.

  useGrenzTool(g, {
    name: "search_jobs",
    title: "Search jobs",
    description:
      "Search the job board. Combine a keyword with any of the filters; all given filters must match. Returns matching postings without their full descriptions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords matched against title, company, location, tags and summary" },
        tags: { type: "array", items: { type: "string" }, description: "Only postings carrying all of these tags" },
        remote: { type: "boolean", description: "True for remote-only, false for on-site and hybrid only" },
        minSalary: { type: "number", description: "Lowest acceptable salary floor, in euros" },
        limit: { type: "number", description: "Maximum results to return (1-25)" },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({
      query: q = "",
      tags = [],
      remote,
      minSalary,
      limit = 10,
    }: {
      query?: string;
      tags?: string[];
      remote?: boolean;
      minSalary?: number;
      limit?: number;
    }) => {
      setQuery(q);
      setTab("jobs");
      const needle = q.trim().toLowerCase();
      const wanted = tags.map((t) => t.toLowerCase());
      const hits = jobs
        .filter((j) => {
          if (
            needle &&
            ![j.title, j.company, j.location, j.summary, ...j.tags]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          )
            return false;
          const have = j.tags.map((t) => t.toLowerCase());
          if (!wanted.every((t) => have.includes(t))) return false;
          if (remote !== undefined && j.remote !== remote) return false;
          if (minSalary !== undefined && j.salaryMin < minSalary) return false;
          return true;
        })
        .slice(0, limit);
      return {
        count: hits.length,
        filters: { query: q, tags, remote, minSalary },
        jobs: hits.map(summarise),
      };
    },
  });

  useGrenzTool(g, {
    name: "get_job",
    title: "Get job posting",
    description: "Fetch the full posting for one job by its id, including the complete description.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", description: "e.g. job-1041" } },
      required: ["jobId"],
    },
    // The description is written by the employer, not by us. It is the one
    // field on this page long enough to hide an instruction in, so we say so:
    // this is the spec's "Untrusted Annotation for Tool Responses".
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ jobId }: { jobId: string }) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return { error: `No job with id "${jobId}".` };
      setSelectedId(job.id);
      setTab("jobs");
      return job;
    },
  });

  useGrenzTool(g, {
    name: "list_applications",
    title: "List your applications",
    description:
      "List the applications on this device — both unsent drafts and submitted ones — with the job each belongs to.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter to \"draft\" or \"submitted\"; omit for both" },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ status }: { status?: string }) => {
      setTab("applications");
      const rows = Object.values(apps)
        .filter((a) => !status || a.status === status)
        .map((a) => {
          const job = jobs.find((j) => j.id === a.jobId);
          return {
            jobId: a.jobId,
            title: job?.title ?? a.jobId,
            company: job?.company ?? "unknown",
            status: a.status,
            characters: a.coverLetter.length,
            ...(a.submittedAt ? { submittedAt: a.submittedAt } : {}),
          };
        });
      return { count: rows.length, applications: rows };
    },
  });

  useGrenzTool(g, {
    name: "save_draft",
    title: "Save cover letter draft",
    description:
      "Save a cover letter draft for a job. Nothing is sent to the employer; the draft stays on this page.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        coverLetter: { type: "string", description: "The draft cover letter" },
      },
      required: ["jobId", "coverLetter"],
    },
    execute: async ({ jobId, coverLetter }: { jobId: string; coverLetter: string }) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return { error: `No job with id "${jobId}".` };
      if (apps[jobId]?.status === "submitted")
        return { error: `Your application to ${job.company} is already submitted; withdraw it first.` };
      setSelectedId(jobId);
      setTab("jobs");
      upsert(jobId, { coverLetter, status: "draft" });
      return { saved: true, jobId, characters: coverLetter.length };
    },
  });

  useGrenzTool(g, {
    name: "submit_application",
    title: "Submit application",
    description:
      "Submit the saved application for a job to the employer. This is final and cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        coverLetter: { type: "string", description: "Overrides the saved draft if given" },
      },
      required: ["jobId"],
    },
    execute: async ({ jobId, coverLetter }: { jobId: string; coverLetter?: string }) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return { error: `No job with id "${jobId}".` };
      const at = new Date().toISOString();
      setSelectedId(jobId);
      setTab("jobs");
      upsert(jobId, {
        status: "submitted",
        submittedAt: at,
        ...(coverLetter ? { coverLetter } : {}),
      });
      return { submitted: true, jobId, company: job.company, at };
    },
  });

  useGrenzTool(g, {
    name: "withdraw_application",
    title: "Withdraw application",
    description:
      "Withdraw a submitted application. The employer stops seeing it and your draft is kept on this page.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        reason: { type: "string", description: "Optional note kept for your own records" },
      },
      required: ["jobId"],
    },
    execute: async ({ jobId }: { jobId: string }) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return { error: `No job with id "${jobId}".` };
      if (apps[jobId]?.status !== "submitted")
        return { error: `There is no submitted application to ${job.company} to withdraw.` };
      setSelectedId(jobId);
      setTab("applications");
      setApps((prev) => {
        const existing = prev[jobId];
        if (!existing) return prev;
        const { submittedAt: _s, ...rest } = existing;
        return { ...prev, [jobId]: { ...rest, status: "draft" } };
      });
      return { withdrawn: true, jobId, company: job.company };
    },
  });

  // --- protection + the third-party widget --------------------------------

  const toggleProtection = useCallback((next: boolean) => {
    setProtection(next);
    g.setEnabled(next);
    if (next) setBreach(null);
  }, []);

  const onWidgetSubmit = useCallback(
    (jobId: string) => {
      // This only ever runs when protection is off. Under the policy the call
      // is denied before it reaches the widget's implementation.
      upsert(jobId, { status: "submitted", submittedAt: new Date().toISOString() });
      setSelectedId(jobId);
      const job = jobs.find((j) => j.id === jobId);
      setBreach(
        `finalize_application just submitted your application to ${job?.company ?? jobId} — no card, no confirmation, nothing you could have stopped.`,
      );
    },
    [upsert],
  );

  const toggleWidget = useCallback(
    (next: boolean) => {
      setWidgetLoaded(next);
      if (next) loadThirdPartyWidget(onWidgetSubmit);
      else unloadThirdPartyWidget();
    },
    [onWidgetSubmit],
  );

  const current = selected ? apps[selected.id] : undefined;
  const appCount = Object.keys(apps).length;

  return (
    <div className="app">
      <Header
        webmcp={webmcp}
        polyfilled={polyfilled}
        protection={protection}
        onProtection={toggleProtection}
        widgetLoaded={widgetLoaded}
        onWidget={toggleWidget}
        simOpen={simOpen}
        onSim={() => setSimOpen((v) => !v)}
      />

      {!protection && (
        <Banner kind="danger">
          Grenz protection is OFF. Every tool on this page — including anything a third-party script
          registered — now runs the moment an agent asks, with no policy and no approval.
        </Banner>
      )}

      {breach && (
        <Banner kind="danger">
          {breach}
          <button className="ghost-btn banner-cta" onClick={() => toggleProtection(true)}>
            Turn protection back on
          </button>
        </Banner>
      )}

      {!webmcp && (
        <Banner kind="info">
          No WebMCP found in this browser. Open this page in ChatGPT's in-app browser, or enable{" "}
          <code>chrome://flags/#enable-webmcp-testing</code> in Chrome. Meanwhile the simulator on
          the right calls the same governed tools.
        </Banner>
      )}

      <div className="main">
        <div className="col jobs">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "jobs"}
              className={`tab ${tab === "jobs" ? "on" : ""}`}
              onClick={() => setTab("jobs")}
            >
              Jobs
            </button>
            <button
              role="tab"
              aria-selected={tab === "applications"}
              className={`tab ${tab === "applications" ? "on" : ""}`}
              onClick={() => setTab("applications")}
            >
              Applications{appCount > 0 && <span className="tab-count">{appCount}</span>}
            </button>
          </div>

          {tab === "jobs" ? (
            <JobList
              jobs={visible}
              total={jobs.length}
              query={query}
              onQuery={setQuery}
              selectedId={selectedId}
              apps={apps}
              onSelect={setSelectedId}
            />
          ) : (
            <ApplicationsList
              jobs={jobs}
              apps={apps}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setTab("jobs");
              }}
            />
          )}
        </div>

        <div className="col">
          <div className="col-scroll">
            {selected ? (
              <div className="detail">
                <JobDetail job={selected} />
                <ApplyPanel
                  job={selected}
                  draft={current?.coverLetter ?? ""}
                  status={current?.status}
                  onDraft={(text) => upsert(selected.id, { coverLetter: text })}
                  onSaveDraft={() => upsert(selected.id, { status: "draft" })}
                  onSubmit={() =>
                    upsert(selected.id, {
                      status: "submitted",
                      submittedAt: new Date().toISOString(),
                    })
                  }
                  onWithdraw={() =>
                    setApps((prev) => {
                      const existing = prev[selected.id];
                      if (!existing) return prev;
                      const { submittedAt: _s, ...rest } = existing;
                      return { ...prev, [selected.id]: { ...rest, status: "draft" } };
                    })
                  }
                />
              </div>
            ) : (
              <EmptyDetail />
            )}
          </div>
        </div>

        <div className="col rail">
          <GrenzTimeline g={g} className="rail-timeline" />
          <div className="rail-foot">
            <strong>Every</strong> registration and call on this page passes through the policy —
            including tools Grenz did not register itself.
          </div>
        </div>
      </div>

      {simOpen && <Simulator g={g} webmcp={webmcp} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
