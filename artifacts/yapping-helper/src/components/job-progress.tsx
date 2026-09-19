import { useDeleteJob, useGetJob, useRegenerateJob } from '@workspace/api-client-react';
import { JobStatus, getGetJobQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, Loader2, Sparkles, AlertCircle, Trash2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
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

interface JobProgressProps {
  jobId: string;
  onComplete: () => void;
  onDeleted: () => void;
}

const STEPS = [
  { id: 'UPLOADED', label: 'UPLOADED' },
  { id: 'TRANSCRIBING', label: 'TRANSCRIBING' },
  { id: 'ANALYZING', label: 'ANALYZING' },
  { id: 'RENDERING', label: 'RENDERING' },
  { id: 'COMPLETE', label: 'COMPLETE' }
];

function formatElapsed(createdAt: string, now: number) {
  const startedAt = Date.parse(createdAt);
  if (!Number.isFinite(startedAt)) return null;

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours}h ${minutes}m ${seconds}s`
    : `${minutes}m ${seconds}s`;
}

function safeProcessingError(error?: string | null) {
  const normalized = error?.toLowerCase() ?? '';

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'Video rendering timed out before it could finish. Retry processing to try again.';
  }

  if (normalized.includes('command failed') || normalized.includes('ffmpeg')) {
    return 'Video rendering failed. Retry processing to try again.';
  }

  return 'Processing failed before your clips could be created. Retry processing to try again.';
}

function stageExplanation(status: JobStatus) {
  switch (status) {
    case JobStatus.UPLOADED:
      return 'Preparing the uploaded video for processing.';
    case JobStatus.TRANSCRIBING:
      return 'Turning the video audio into a transcript.';
    case JobStatus.ANALYZING:
      return 'Finding the strongest moments for your clips.';
    case JobStatus.RENDERING:
      return 'Rendering the selected clips. Longer source videos can take several minutes.';
    default:
      return null;
  }
}

export function JobProgress({ jobId, onComplete, onDeleted }: JobProgressProps) {
  const deleteJob = useDeleteJob();
  const regenerateJob = useRegenerateJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const { data: job, isError, error } = useGetJob(jobId, {
    query: {
      refetchInterval: (query) => {
        // Stop polling if complete or failed
        const status = query.state.data?.status;
        if (status === JobStatus.COMPLETE || status === JobStatus.FAILED) {
          return false;
        }
        return 2000; // Poll every 2 seconds
      },
      queryKey: getGetJobQueryKey(jobId),
    }
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (job?.status === JobStatus.COMPLETE) {
      onComplete();
    }
  }, [job?.status, onComplete]);

  if (isError) {
    const isNotFound = error && 'status' in error && error.status === 404;
    return (
      <div className="w-full max-w-2xl mx-auto text-center space-y-6 animate-in fade-in">
        <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto text-destructive">
          <AlertCircle className="w-10 h-10" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">{isNotFound ? 'Job not found' : 'Something went wrong'}</h2>
          <p className="text-muted-foreground mt-2 font-mono">
            {isNotFound
              ? 'The job in this URL does not exist or is no longer available.'
              : error?.message || "Failed to load job status."}
          </p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="mt-4 font-mono font-bold animate-pulse text-muted-foreground">Loading job...</p>
      </div>
    );
  }

  if (job.status === JobStatus.FAILED) {
    const elapsed = formatElapsed(job.createdAt, now);

    const handleRetry = () => {
      if (regenerateJob.isPending) return;

      regenerateJob.mutate(
        { jobId },
        {
          onSuccess: (updatedJob) => {
            queryClient.setQueryData(getGetJobQueryKey(jobId), updatedJob);
            void queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
            toast({
              title: 'Processing restarted',
              description: 'Your existing upload is being processed again.',
            });
          },
          onError: (retryError) => {
            toast({
              title: 'Could not restart processing',
              description: safeProcessingError(retryError.message),
              variant: 'destructive',
            });
          },
        },
      );
    };

    return (
      <div className="w-full max-w-2xl mx-auto text-center space-y-6 animate-in fade-in">
        <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto text-destructive">
          <AlertCircle className="w-10 h-10" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Processing Failed</h2>
          <p className="text-muted-foreground mt-2 font-mono" data-testid="text-processing-error">
            {safeProcessingError(job.error)}
          </p>
          {elapsed && (
            <p className="text-sm text-muted-foreground mt-2" data-testid="text-processing-elapsed">
              Elapsed time: {elapsed}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            className="font-bold"
            onClick={handleRetry}
            disabled={regenerateJob.isPending || deleteJob.isPending}
            data-testid="button-retry-processing"
          >
            {regenerateJob.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {regenerateJob.isPending ? 'Restarting…' : 'Retry processing'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                className="font-bold"
                disabled={regenerateJob.isPending}
                data-testid="button-delete-failed-job"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete failed job
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
                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteJob.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete"
                  onClick={() => deleteJob.mutate(
                    { jobId },
                    {
                      onSuccess: () => {
                        toast({ title: 'Job permanently deleted' });
                        onDeleted();
                      },
                      onError: (deleteError) => toast({
                        title: 'Failed to delete job',
                        description: deleteError.message || 'The job and its files could not be deleted.',
                        variant: 'destructive',
                      }),
                    },
                  )}
                >
                  {deleteJob.isPending ? 'Deleting…' : 'Delete everything'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  }

  const displayStatus = job.status;
  const currentStepIndex = STEPS.findIndex(s => s.id === displayStatus);
  const elapsed = formatElapsed(job.createdAt, now);
  const explanation = stageExplanation(displayStatus);
  
  return (
    <div className="w-full max-w-2xl mx-auto space-y-12 animate-in fade-in">
      <div className="text-center space-y-4">
        <div className="relative w-24 h-24 mx-auto">
          <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
          <div className="absolute inset-2 bg-primary/30 rounded-full animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="w-10 h-10 text-primary animate-bounce" />
          </div>
        </div>
        <h2 className="text-3xl font-black uppercase tracking-tight">Working Magic</h2>
        <p className="text-muted-foreground font-mono">
          {job.currentStep || "Processing your masterpiece..."}
        </p>
        {explanation && (
          <p className="text-sm text-muted-foreground" data-testid="text-stage-explanation">
            {explanation}
          </p>
        )}
        {elapsed && (
          <p className="text-sm font-mono text-muted-foreground" data-testid="text-processing-elapsed">
            Elapsed time: {elapsed}
          </p>
        )}
      </div>

      <div className="bg-card border-2 border-border p-8 rounded-lg shadow-xl">
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            <span className="font-bold text-sm">Overall Progress</span>
            <span className="font-mono text-sm font-bold text-primary" data-testid="text-progress-percent">{Math.round(job.progress)}%</span>
          </div>
          <Progress value={job.progress} className="h-3" />
        </div>

        <div className="space-y-6">
          {STEPS.map((step, index) => {
            const isCompleted = currentStepIndex > index || displayStatus === JobStatus.COMPLETE;
            const isCurrent = currentStepIndex === index && displayStatus !== JobStatus.COMPLETE;
            const isPending = currentStepIndex < index && displayStatus !== JobStatus.COMPLETE;

            return (
              <div 
                key={step.id} 
                className={cn(
                  "flex items-center gap-4 transition-all duration-300",
                  isPending && "opacity-40",
                  isCurrent && "scale-[1.02] transform"
                )}
              >
                <div className="relative">
                  {isCompleted ? (
                    <CheckCircle2 className="w-6 h-6 text-primary" />
                  ) : isCurrent ? (
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  ) : (
                    <Circle className="w-6 h-6 text-muted-foreground" />
                  )}
                  {index < STEPS.length - 1 && (
                    <div className={cn(
                      "absolute top-6 left-3 w-px h-6 -translate-x-1/2",
                      isCompleted ? "bg-primary" : "bg-border"
                    )} />
                  )}
                </div>
                <span className={cn(
                  "font-bold text-lg",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                  isCompleted && "text-foreground"
                )}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
