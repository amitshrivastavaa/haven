export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  salaryMin: number;
  remote: boolean;
  tags: string[];
  posted: string;
  summary: string;
  description: string;
}

export type Status = "draft" | "submitted";

export interface Application {
  jobId: string;
  status: Status;
  coverLetter: string;
  /** ISO timestamp of the submission, absent while still a draft. */
  submittedAt?: string;
}
