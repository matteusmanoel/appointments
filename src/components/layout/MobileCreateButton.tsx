import { Plus } from "lucide-react";

type MobileCreateButtonProps = {
  label: string;
  onClick: () => void;
};

/** Ação principal de criar, só no mobile. O desktop mantém o botão da página. */
export function MobileCreateButton({ label, onClick }: MobileCreateButtonProps) {
  return (
    <button
      type="button"
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      onClick={onClick}
      aria-label={label}
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
