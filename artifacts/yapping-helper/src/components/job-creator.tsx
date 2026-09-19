import { useRef, useState } from 'react';
import { useCreateJob, useRequestUploadUrl } from '@workspace/api-client-react';
import {
  EditOptionsEffects,
  EditOptionsMusic,
  JobInputClipLength,
  JobInputStyle,
} from '@workspace/api-client-react';
import { Dropzone } from '@/components/dropzone';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface JobCreatorProps {
  onJobCreated: (jobId: string) => void;
}

export function JobCreator({ onJobCreated }: JobCreatorProps) {
  const [file, setFile] = useState<File | null>(null);
  const [clipCount, setClipCount] = useState(3);
  const [clipLength, setClipLength] = useState<JobInputClipLength>(JobInputClipLength.short);
  const [style, setStyle] = useState<JobInputStyle>(JobInputStyle.auto);
  const [music, setMusic] = useState<EditOptionsMusic>(EditOptionsMusic.off);
  const [effects, setEffects] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  
  const { toast } = useToast();
  const createJob = useCreateJob();
  const requestUploadUrl = useRequestUploadUrl();
  const lengthHelp: Record<JobInputClipLength, string> = {
    [JobInputClipLength.short]: 'Target 15–30 seconds; variations may run about 12–33 seconds.',
    [JobInputClipLength.medium]: 'Target 30–60 seconds; variations may run about 27–63 seconds.',
    [JobInputClipLength.long]: 'Target 60–90 seconds; variations may run about 57–93 seconds.',
  };
  const styleHelp: Record<JobInputStyle, string> = {
    [JobInputStyle.auto]: 'Clean, bold sans captions.',
    [JobInputStyle.educational]: 'Readable serif captions on a calm, shaded background.',
    [JobInputStyle.punchy]: 'Bold pop captions.',
    [JobInputStyle.storytelling]: 'Serif captions with a gentle fade.',
    [JobInputStyle.interesting]: 'Accent sans captions.',
    [JobInputStyle.opinionated]: 'Heavy, bold captions.',
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!file) {
      toast({
        title: "No video selected",
        description: "Please upload a video to generate clips.",
        variant: "destructive"
      });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const upload = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || 'video/mp4',
        },
      }
      );
      const uploadResponse = await fetch(upload.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'video/mp4' },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error('The video could not be uploaded to storage.');
      }
      const job = await createJob.mutateAsync({
        data: {
          objectPath: upload.objectPath,
          originalFilename: file.name,
           clipCount,
           clipLength,
           style,
            editOptions: {
              music,
              effects: effects ? EditOptionsEffects.punchy : EditOptionsEffects.none,
              musicVolume,
            },
        },
      });
      onJobCreated(job.id);
    } catch (error) {
      toast({
        title: "Failed to start processing",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive"
      });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-12 animate-in fade-in zoom-in-95 duration-500">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight uppercase">
          YAP LESS. <span className="text-primary">POST MORE.</span>
        </h1>
          <p className="text-xl text-muted-foreground font-mono max-w-2xl mx-auto">
            AI reviews your video and selects strong moments for ready-to-share vertical clips.
        </p>
      </div>

      <div className="bg-card border-2 border-border p-6 md:p-8 rounded-lg shadow-xl shadow-primary/5 space-y-8">
        <div>
          <h2 className="text-xl font-bold mb-4">1. Upload Video</h2>
          <Dropzone file={file} onFileSelect={setFile} />
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
             <Label className="text-base font-bold">Number of Clips</Label>
              <span className="font-mono bg-muted px-2 py-1 rounded text-sm font-bold">{clipCount}</span>
            </div>
            <Slider
              value={[clipCount]}
              min={1}
              max={10}
              step={1}
              onValueChange={([value]) => setClipCount(value)}
              className="py-4"
            />
            <p className="text-sm text-muted-foreground">
              Choose between 1 and 10 AI-selected clips.
            </p>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <Label className="text-base font-bold">Clip Length</Label>
              <Select value={clipLength} onValueChange={(value) => setClipLength(value as JobInputClipLength)}>
                <SelectTrigger className="w-full border-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={JobInputClipLength.short}>Short (15–30 seconds)</SelectItem>
                  <SelectItem value={JobInputClipLength.medium}>Medium (30–60 seconds)</SelectItem>
                  <SelectItem value={JobInputClipLength.long}>Long (60–90 seconds)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {lengthHelp[clipLength]} We create distinct variations, typically within 2–3 seconds of the target.
              </p>
            </div>

            <div className="space-y-3">
              <Label className="text-base font-bold">Editing Style</Label>
              <Select value={style} onValueChange={(value) => setStyle(value as JobInputStyle)}>
                <SelectTrigger className="w-full border-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={JobInputStyle.auto}>Auto</SelectItem>
                  <SelectItem value={JobInputStyle.educational}>Educational</SelectItem>
                  <SelectItem value={JobInputStyle.punchy}>Punchy</SelectItem>
                  <SelectItem value={JobInputStyle.storytelling}>Storytelling</SelectItem>
                  <SelectItem value={JobInputStyle.interesting}>Interesting</SelectItem>
                  <SelectItem value={JobInputStyle.opinionated}>Opinionated</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{styleHelp[style]}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 rounded-lg border border-border bg-muted/20 p-4">
          <h2 className="text-base font-bold">Sound &amp; effects</h2>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="background-music" className="font-bold">Background music</Label>
              <Select value={music} onValueChange={(value) => setMusic(value as EditOptionsMusic)}>
                <SelectTrigger id="background-music" className="w-full border-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EditOptionsMusic.off}>Off</SelectItem>
                  <SelectItem value={EditOptionsMusic.upbeat}>Upbeat</SelectItem>
                  <SelectItem value={EditOptionsMusic.chill}>Chill</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Music stays under speech.</p>
            </div>
            <div className="flex items-start justify-between gap-4 pt-1 md:pt-7">
              <div>
                <Label htmlFor="punchy-effects" className="font-bold">Subtle effects</Label>
                <p className="mt-1 text-xs text-muted-foreground">Gentle punch-ins and richer color.</p>
              </div>
              <Switch
                id="punchy-effects"
                checked={effects}
                onCheckedChange={setEffects}
                aria-label="Subtle punchy effects"
              />
            </div>
          </div>
          {music !== EditOptionsMusic.off && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="music-volume" className="font-bold">Music under speech</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.round(musicVolume * 100)}%
                </span>
              </div>
              <Slider
                id="music-volume"
                value={[musicVolume]}
                min={0}
                max={0.25}
                step={0.01}
                onValueChange={([value]) => setMusicVolume(value)}
              />
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-border">
          <Button
            size="lg"
            className="w-full text-lg font-bold h-14"
            onClick={handleSubmit}
             disabled={!file || isSubmitting}
          >
             {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                 Uploading...
              </>
            ) : (
              `Create ${clipCount} ${clipCount === 1 ? 'clip' : 'clips'}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
