import { createContext, useContext, useEffect, type ReactNode } from "react";

type MobilePageTitleContextValue = {
  title: string | null;
  setTitle: (title: string | null) => void;
};

const MobilePageTitleContext = createContext<MobilePageTitleContextValue | null>(null);

export function MobilePageTitleProvider({
  value,
  children,
}: {
  value: MobilePageTitleContextValue;
  children: ReactNode;
}) {
  return <MobilePageTitleContext.Provider value={value}>{children}</MobilePageTitleContext.Provider>;
}

export function useMobilePageTitle(title: string) {
  const ctx = useContext(MobilePageTitleContext);
  const setTitle = ctx?.setTitle;
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
