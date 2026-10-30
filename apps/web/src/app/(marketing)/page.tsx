import Link from 'next/link';

// Public pages are server-rendered / static. Content must come from ONE source (CMS/config), not hardcoded
// across components. TODO: move copy to src/i18n + a content config. See docs/07-UI-MIGRATION.md.
export default function HomePage() {
  return (
    <main>
      <section className="bg-shell px-6 py-24 text-center text-white">
        <h1 className="text-4xl font-extrabold md:text-6xl">
          Sirat <span className="text-primary">Leadership</span> Olympiad
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-white/80">
          A GLTS Leadership × Sirat Olympiad partnership. Register, take the 30-minute exam, and
          rise on the leaderboard.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/register"
            className="rounded-control bg-primary-strong px-6 py-3 font-semibold text-white"
          >
            Register
          </Link>
          <Link
            href="/login"
            className="rounded-control border border-white/30 px-6 py-3 font-semibold"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
