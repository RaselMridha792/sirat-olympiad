/**
 * The About page's facts (owner, 2026-11-03: built now with what we have). The advisory board and the convenor team
 * stay hidden until the client sends the names (one flag); photos come later, as optimised images, never a
 * hot-linked file. The texts are in i18n/messages/about.ts.
 */
export interface TeamMember {
  name: string;
  /** The title or role, as the client gives it. */
  role: string;
}

export interface AboutFacts {
  team: {
    show: boolean;
    advisers: readonly TeamMember[];
    convenors: readonly TeamMember[];
  };
}

export const aboutFacts: AboutFacts = {
  team: { show: false, advisers: [], convenors: [] },
};
