export function JumpingDots() {
  return (
    <div className="inline-flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-300"
          style={{ animation: "dot-jump 0.9s infinite", animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </div>
  );
}