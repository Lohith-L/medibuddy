import { createContext, useContext, useState, ReactNode } from "react";

interface SOSContextValue {
  open: boolean;
  openSOS: () => void;
  closeSOS: () => void;
}

const SOSContext = createContext<SOSContextValue>({
  open: false,
  openSOS: () => {},
  closeSOS: () => {},
});

export const SOSProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <SOSContext.Provider value={{ open, openSOS: () => setOpen(true), closeSOS: () => setOpen(false) }}>
      {children}
    </SOSContext.Provider>
  );
};

export const useSOS = () => useContext(SOSContext);

