// The Matterport 3D walk-through of a space, embedded on the page.
// Uses the public tour link, so no key is needed. The SDK key is only for adding pins inside the 3D view later.

export function Tour3D({ modelId, title }: { modelId: string; title: string }) {
  if (!modelId) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-400">
        No 3D scan for this space yet
      </div>
    );
  }

  const src = `https://my.matterport.com/show/?m=${modelId}&play=1&qs=1`;

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200">
      <iframe
        src={src}
        title={`3D tour of ${title}`}
        className="aspect-video w-full"
        allow="fullscreen; xr-spatial-tracking"
        allowFullScreen
      />
    </div>
  );
}
