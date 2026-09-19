import { useState, useCallback } from 'react';
import { UploadCloud, Video, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface DropzoneProps {
  file: File | null;
  onFileSelect: (file: File | null) => void;
}

export function Dropzone({ file, onFileSelect }: DropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      onFileSelect(droppedFile);
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      onFileSelect(selectedFile);
    }
  }, [onFileSelect]);

  if (file) {
    return (
      <div className="border-2 border-primary bg-primary/5 p-6 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/20 rounded-md flex items-center justify-center text-primary">
            <Video className="w-6 h-6" />
          </div>
          <div>
            <p className="font-bold text-foreground truncate max-w-[200px] sm:max-w-[400px]">
              {file.name}
            </p>
            <p className="text-sm text-muted-foreground font-mono">
              {(file.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onFileSelect(null)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <X className="w-5 h-5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg p-12 transition-all duration-200 ease-out cursor-pointer",
        isDragActive 
          ? "border-primary bg-primary/5 scale-[1.02]" 
          : "border-border hover:border-primary hover:bg-primary/5"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => document.getElementById('file-upload')?.click()}
    >
      <input
        id="file-upload"
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileInput}
      />
      <div className="flex flex-col items-center text-center gap-4 pointer-events-none">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
          <UploadCloud className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Drop your long video here</h3>
          <p className="text-muted-foreground mt-1 max-w-sm">
            Or click to browse. We accept MP4, MOV, and WebM up to 2GB.
          </p>
        </div>
      </div>
    </div>
  );
}
