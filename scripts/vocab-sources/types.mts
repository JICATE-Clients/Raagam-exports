// The one shape every vocabulary source hands back.
//
// A source's whole job is to answer "what names might belong to class X, and
// where did each one come from?". It does NOT decide whether a name is good —
// `sanitise()` in the miner does the rejecting, and a human does the accepting.
// Keeping sources dumb is what lets a new one be added in fifty lines.

export type MinedTerm = {
  /** Candidate name, as the source gave it. Un-normalised — the miner normalises. */
  term: string;
  /** The item class code this term is proposed FOR. Never a list: one term, one class. */
  classCode: string;
  /** Source id, e.g. "hsn". Printed in the review file so a proposal is traceable. */
  source: string;
  /** Where inside the source, e.g. "5209.12.40". Printed beside the term. */
  ref: string;
};

export type VocabSource = {
  id: string;
  /** One line for the review file header, so the reviewer knows what they are judging. */
  note: string;
  fetch(): Promise<MinedTerm[]>;
};

/** Shared politeness header — Wikimedia asks for a contactable UA on API traffic. */
export const USER_AGENT =
  "raagam-vocab-miner/1.0 (offline build-time vocabulary miner; run by hand, not a crawler)";
