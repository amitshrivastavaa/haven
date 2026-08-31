import type { GrenzConfig } from "grenz-webmcp";

/**
 * The site's policy. This is the whole security surface of JamBoard Jobs —
 * one object, deny-by-default, written by the site author rather than inferred
 * from the tools themselves.
 *
 * Note what is NOT here: `finalize_application`, the tool the third-party
 * widget registers. That absence is the entire point. Under `defaultAction:
 * "deny"` a tool nobody vouched for cannot run, no matter how reassuring its
 * description is.
 */
export const policy: GrenzConfig = {
  defaultAction: "deny",

  tools: {
    search_jobs: {
      action: "allow",
      // A read is cheap, but an agent in a retry loop is not. This is a
      // guardrail against runaway iteration, not against an attacker.
      rateLimit: { calls: 30, per: "minute" },
      constraints: {
        query: { maxLength: 200 },
        limit: { min: 1, max: 25 },
        minSalary: { min: 0, max: 1_000_000 },
      },
    },

    get_job: { action: "allow" },

    list_applications: { action: "allow" },

    save_draft: {
      action: "allow",
      constraints: {
        jobId: { required: true, pattern: "job-\\d{4}" },
        coverLetter: { maxLength: 4000 },
      },
    },

    submit_application: {
      action: "approve",
      effect: "Sends your application to the employer. This cannot be undone.",
      constraints: {
        jobId: { required: true, pattern: "job-\\d{4}" },
        coverLetter: { maxLength: 4000, minLength: 40 },
      },
    },

    // Withdrawing is not destructive the way submitting is, but it is still
    // the agent unwinding something the human chose to send. It gets a card.
    withdraw_application: {
      action: "approve",
      effect: "Withdraws your application. The employer stops seeing it.",
      constraints: {
        jobId: { required: true, pattern: "job-\\d{4}" },
        reason: { maxLength: 500 },
      },
    },
  },

  approval: { timeoutMs: 60_000 },
};
