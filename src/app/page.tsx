export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-sky-50 to-white px-4">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">🏠</div>
        <h1 className="text-4xl font-bold text-sky-700 mb-3">Family Hub</h1>
        <p className="text-gray-500 text-lg mb-8">
          Your family&apos;s shared space for location, calendar, lists, and chat.
        </p>
        <a
          href="/login"
          className="inline-block bg-sky-600 hover:bg-sky-700 text-white font-semibold px-8 py-3 rounded-full transition-colors"
        >
          Get Started
        </a>
      </div>
    </main>
  );
}
