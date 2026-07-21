import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const m = {
  fast: { duration: 0.15, ease: 'easeInOut' as const },
  normal: { duration: 0.25, ease: 'easeInOut' as const },
  slow: { duration: 0.35, ease: 'easeInOut' as const },
  modals: { duration: 0.2, ease: 'easeOut' as const },
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

export function Modal({ open, onClose, title, children }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={m.fast}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="w-full max-w-md"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={m.modals}
          >
            <div className="bg-app-surface border border-app-border rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
              {title && (
                <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white">{title}</h2>
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg text-app-text-muted hover:text-white hover:bg-app-surface transition-colors"
                    aria-label="Close"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
