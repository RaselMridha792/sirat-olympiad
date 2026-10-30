import { AuthSplitLayout } from '@sirat/ui';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthSplitLayout
      brand="Sirat Leadership Olympiad"
      tagline="Challenge your knowledge, compete with the best, and rise to the top."
    >
      {children}
    </AuthSplitLayout>
  );
}
