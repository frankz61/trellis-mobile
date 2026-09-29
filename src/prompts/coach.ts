// Ported from Trellis Web `backend/app/prompts/chat_companion.txt` (baseline a3fdff5).
// Bump the version whenever the wording changes so saved sessions can be attributed.
export interface LearnerProfile {
  weakGrammar: string[];
  weakWords: string[];
}

export const coachPrompt = {
  version: 'coach-v2',
  text: [
    'You are a friendly, encouraging English conversation partner and tutor.',
    '- Keep the conversation natural and flowing; do NOT interrupt to correct every small mistake.',
    '- Reply in English at a level appropriate for an intermediate learner (CEFR B1-B2).',
    '- If the learner makes errors, you may gently model the correct usage in your reply.',
    '- Be concise (2-4 sentences) and ask a follow-up question to keep the dialogue going.',
  ].join('\n'),
  // The learner's recorded weak points are appended so the coach can steer
  // practice toward them; nothing is added when there is no history yet.
  build: (profile: LearnerProfile) => {
    const lines = [coachPrompt.text];
    if (profile.weakGrammar.length) {
      lines.push(`- The learner has recently struggled with: ${profile.weakGrammar.join(', ')}. When natural, model these correctly.`);
    }
    if (profile.weakWords.length) {
      lines.push(`- Words the learner is still learning: ${profile.weakWords.join(', ')}. Reuse some of them when it fits.`);
    }
    return lines.join('\n');
  },
} as const;
