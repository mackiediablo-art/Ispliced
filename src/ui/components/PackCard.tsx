import { SpliceSamplePack } from "../../splice/api";

export default function PackCard({ pack, onOpen }: {
  pack: SpliceSamplePack;
  onOpen: (pack: SpliceSamplePack) => void;
}) {
  return (
    <button type="button" onClick={() => onOpen(pack)}
      aria-label={`Open pack ${pack.name}`}
      className="group text-left rounded-2xl overflow-hidden bg-surface-secondary cursor-pointer
                 transition-colors hover:bg-surface-tertiary focus-visible:outline-2 focus-visible:outline-accent">
      <img src={pack.files.find(file => file.asset_file_type_slug == "cover_image")?.url || "/img/missing-cover.png"}
        alt={`${pack.name} artwork`} draggable={false}
        onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = "/img/missing-cover.png"; }}
        className="aspect-square w-full object-cover" />
      <div className="p-4 space-y-1">
        <h2 className="font-medium line-clamp-2">{pack.name}</h2>
        <p className="text-sm text-muted">View samples →</p>
      </div>
    </button>
  );
}
