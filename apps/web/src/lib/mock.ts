// MOCK DATA FOR SCAFFOLD PREVIEW ONLY. Delete when real endpoints exist.
// (Old project shipped mock JSON in public/ — never do that. Keep mocks in code, not in public/.)
export const mockLeaderboard = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1,
  name: `Participant ${i + 1}`,
  institution: 'Sample School',
  category: ['activist', 'ambassador', 'achiever'][i % 3] as string,
}));

export const mockUsers = Array.from({ length: 8 }, (_, i) => ({
  id: `u${i + 1}`,
  name: `Student ${i + 1}`,
  email: `student${i + 1}@example.com`,
  role: i === 0 ? 'admin' : 'student',
  status: i % 5 === 4 ? 'blocked' : 'active',
}));
