function initials(displayName: string) {
  const parts = displayName.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

export default function Avatar({
  name,
  url,
  size = 44,
}: {
  name: string;
  url: string | null;
  size?: number;
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        className="rounded-full object-cover bg-gray-100"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-semibold"
    >
      {initials(name)}
    </div>
  );
}
