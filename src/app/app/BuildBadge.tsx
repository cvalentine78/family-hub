// Tiny build indicator, bottom-right. A server component (not client JS), so
// even if the phone's WebView is holding a stale cached bundle, a fresh page
// load still shows the TRUE deployed commit — making a stale build obvious
// instead of guessing. Vercel sets VERCEL_GIT_COMMIT_SHA automatically at
// build/runtime; falls back to "dev" when running locally.
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const short = sha ? sha.slice(0, 7) : "dev";

export default function BuildBadge() {
  return (
    <div className="fixed bottom-16 lg:bottom-1 right-1 z-30 text-[10px] leading-none text-gray-300 select-none pointer-events-none">
      {short}
    </div>
  );
}
