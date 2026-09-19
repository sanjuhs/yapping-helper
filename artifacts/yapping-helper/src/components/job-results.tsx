import { useState } from 'react';
import { useDeleteJob, useGetJob, useRegenerateJob, getGetJobQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, Instagram, Loader2, Play, FileText, Trash2, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { downloadJobCsv } from '@/lib/job-csv';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface JobResultsProps {
  jobId: string;
  onDeleted: () => void;
}

export function JobResults({ jobId, onDeleted }: JobResultsProps) {
  const { data: job, isLoading, isError, error } = useGetJob(jobId);
  const regenerateJob = useRegenerateJob();
  const deleteJob = useDeleteJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [previewErrors, setPreviewErrors] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="w-full max-w-2xl mx-auto text-center space-y-3">
        <h2 className="text-2xl font-bold">Unable to load clips</h2>
        <p className="text-muted-foreground font-mono">
          {error?.message || 'This job could not be found.'}
        </p>
      </div>
    );
  }

  const handleRegenerate = () => {
    regenerateJob.mutate(
      { jobId },
      {
        onSuccess: (updatedJob) => {
          queryClient.setQueryData(getGetJobQueryKey(jobId), updatedJob);
          void queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
          toast({
            title: "Regeneration started",
            description: "AI is selecting and rendering a fresh set of clips.",
          });
        },
        onError: (error) => {
          toast({
            title: "Failed to regenerate",
            description: error.message || "Something went wrong.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handleDelete = () => {
    deleteJob.mutate(
      { jobId },
      {
        onSuccess: () => {
          toast({ title: 'Job permanently deleted' });
          onDeleted();
        },
        onError: (error) => {
          toast({
            title: 'Failed to delete job',
            description: error.message || 'The job and its files could not be deleted.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const formatTimestamp = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.max(0, seconds - minutes * 60);
    return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
  };
  const music = job.editOptions?.music ?? 'off';
  const effects = job.editOptions?.effects ?? 'none';

  return (
    <div className="w-full max-w-5xl mx-auto space-y-12 animate-in fade-in zoom-in-95 duration-500">
      {job.status === 'FAILED' && (
        <p role="alert" className="border border-destructive p-4 rounded text-sm">
          Regeneration failed: {job.error}. Your previous clips are still available below.
        </p>
      )}
      <div className="flex flex-col md:flex-row justify-between items-center gap-6 text-center md:text-left">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tight">Your Clips Are Ready</h1>
          <p className="text-muted-foreground font-mono mt-2">
            AI selected these moments based on your content and chosen style. Results are creative suggestions, not a guarantee of reach or virality.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Music: <span className="font-bold capitalize text-foreground">{music}</span>
            {' · '}
            Effects: <span className="font-bold capitalize text-foreground">{effects}</span>
          </p>
        </div>
        
        <div className="flex flex-wrap justify-center gap-3 md:max-w-[420px]">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="lg" className="font-bold">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete job
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete this job?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the original upload, all generated MP4, SRT, and ASS
                  outputs, and the transcript. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleteJob.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteJob.isPending ? 'Deleting…' : 'Delete everything'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button 
            variant="outline" 
            size="lg" 
            className="font-bold border-2 border-primary/20 hover:border-primary hover:bg-primary/5"
            onClick={handleRegenerate}
            disabled={regenerateJob.isPending}
          >
            {regenerateJob.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
             Render again
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="font-bold border-2"
            onClick={() => downloadJobCsv(job, window.location)}
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button 
            size="lg" 
            className="font-bold"
            disabled
          >
            <Instagram className="w-4 h-4 mr-2" />
            Connect Instagram
          </Button>
        </div>
      </div>

      {import.meta.env.DEV && (
        <p role="note" className="rounded border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          CSV links use this app's current address. Export from the published app for durable demo links.
        </p>
      )}

      {job.transcription && (
        <details className="bg-card border-2 border-border rounded-lg p-5">
          <summary className="cursor-pointer font-bold font-mono">Debug transcript</summary>
          <div className="mt-4 max-h-72 overflow-y-auto space-y-3 text-sm">
            {job.transcription.segments.length > 0 ? job.transcription.segments.map((segment, index) => (
              <p key={`${segment.start}-${index}`} className="grid grid-cols-[5rem_1fr] gap-3">
                <span className="font-mono text-muted-foreground">
                  {formatTimestamp(segment.start)}
                </span>
                <span>{segment.text}</span>
              </p>
            )) : (
              <p className="whitespace-pre-wrap">{job.transcription.text}</p>
            )}
          </div>
        </details>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {job.clips.map((clip) => (
          <div key={clip.id} className="bg-card border-2 border-border rounded-lg overflow-hidden flex flex-col shadow-lg hover:border-primary/50 transition-colors group">
            <div className="relative aspect-[9/16] bg-black/5 flex items-center justify-center overflow-hidden">
              {previewErrors[clip.id] ? (
                <p role="alert" className="p-6 text-center text-sm">
                  This browser could not play the MP4. Use Save below to download it,
                  or try a browser with H.264/AAC support.
                </p>
              ) : clip.previewUrl ? (
                <video 
                  src={clip.previewUrl} 
                  className="w-full h-full object-cover"
                  controls
                  controlsList="nodownload"
                  playsInline
                  onError={() => setPreviewErrors((errors) => ({ ...errors, [clip.id]: true }))}
                />
              ) : (
                <div className="text-muted-foreground flex flex-col items-center gap-2">
                  <Play className="w-12 h-12 opacity-50" />
                  <span className="font-mono text-sm font-bold">Preview not available</span>
                </div>
              )}
              
              <div className="absolute top-4 right-4 bg-background/90 backdrop-blur px-2 py-1 rounded font-mono text-xs font-bold border border-border">
                {Math.round(clip.duration)}s
              </div>
            </div>
            
            <div className="p-6 flex-1 flex flex-col">
              <div className="mb-2 text-xs font-bold text-primary font-mono uppercase tracking-wider">
                Clip {clip.index + 1}
              </div>
              <h3 className="text-xl font-bold mb-3 leading-tight">{clip.title}</h3>
              
              <div className="space-y-4 flex-1">
                <div>
                  <div className="text-xs font-bold text-muted-foreground uppercase mb-1">The Hook</div>
                  <p className="text-sm font-mono bg-muted p-3 rounded border border-border/50">
                    "{clip.hook}"
                  </p>
                </div>
                
                <div>
                  <div className="text-xs font-bold text-muted-foreground uppercase mb-1">AI rationale</div>
                  <p className="text-sm text-muted-foreground">
                    {clip.reason}
                  </p>
                </div>

                {clip.sourceSegments && clip.sourceSegments.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground uppercase mb-1">Source moments</div>
                    <p className="text-sm font-mono text-muted-foreground">
                      {clip.sourceSegments.map((segment) => (
                        `${formatTimestamp(segment.start)}–${formatTimestamp(segment.end)}`
                      )).join(', ')}
                    </p>
                  </div>
                )}
              </div>
              
              <div className="mt-6 pt-6 border-t border-border grid grid-cols-2 gap-3">
                <Button
                  asChild
                  variant="outline" 
                  className="w-full font-bold border-2"
                >
                  <a href={clip.downloadUrl} download>
                    <Download className="w-4 h-4 mr-2" />
                    Download MP4
                  </a>
                </Button>
                {clip.subtitleUrl ? (
                  <Button asChild className="w-full font-bold">
                    <a href={clip.subtitleUrl} download>
                      <FileText className="w-4 h-4 mr-2" />
                      Subtitles (.srt)
                    </a>
                  </Button>
                ) : (
                  <Button className="w-full font-bold" disabled>
                    <FileText className="w-4 h-4 mr-2" />
                    No SRT
                  </Button>
                )}
                {clip.styledSubtitleUrl && (
                  <Button asChild variant="outline" className="w-full col-span-2 font-bold">
                    <a href={clip.styledSubtitleUrl} download>
                      <FileText className="w-4 h-4 mr-2" />
                      Styled subtitles (.ass)
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
