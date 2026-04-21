import React, { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/Button';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({ isOpen, onClose, onScanSuccess }) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const regionId = "qr-reader";

  useEffect(() => {
    if (isOpen) {
      const startScanner = async () => {
        try {
          const html5QrCode = new Html5Qrcode(regionId);
          scannerRef.current = html5QrCode;
          
          const config = { fps: 10, qrbox: { width: 250, height: 250 } };
          
          await html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
              onScanSuccess(decodedText);
              stopScanner();
              onClose();
            },
            undefined
          );
        } catch (err) {
          console.error("Error starting QR scanner:", err);
        }
      };

      // Small delay to ensure the DOM element is rendered
      const timer = setTimeout(startScanner, 300);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    }
  }, [isOpen]);

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.error("Error stopping QR scanner:", err);
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden relative"
          >
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
                  <Camera size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Escanear QR</h3>
                  <p className="text-xs text-slate-500">Apunta al código de autorización</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div 
                id={regionId} 
                className="overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800 aspect-square flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700"
              >
                <div className="text-center p-8 text-slate-400">
                  <Camera size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm">Iniciando cámara...</p>
                </div>
              </div>
              
              <div className="mt-6 space-y-4">
                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl text-amber-800 dark:text-amber-200 text-sm">
                  <div className="mt-0.5">⚠️</div>
                  <p>Asegúrate de tener buena iluminación y que el código esté centrado.</p>
                </div>
                
                <Button 
                  variant="secondary" 
                  className="w-full py-4 rounded-2xl"
                  onClick={onClose}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
