import { useState, useCallback } from "react";
import {
  Volume2, VolumeX, User, Upload, Bell, MessageCircle,
  CheckCircle2, Play, RotateCcw, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useNotificationPrefs, DEFAULT_PREFS } from "@/hooks/useNotificationPrefs";
import type { AdminNotificationEvent } from "@/hooks/useNotificationPrefs";
import { playNotificationSound } from "@/hooks/useNotificationSound";
import type { NotificationSoundType } from "@/hooks/useNotificationSound";

interface Props {
  onBack: () => void;
}

const TONE_OPTIONS: { value: NotificationSoundType; label: string; description: string }[] = [
  { value: 'visitor',  label: 'Doorbell',       description: 'Warm ding-dong chime' },
  { value: 'receipt',  label: 'Triple Punch',   description: 'Urgent ascending blips' },
  { value: 'alert',    label: 'Rising Beeps',   description: 'Three rising triangle tones' },
  { value: 'message',  label: 'Two-Note Chime', description: 'Soft ascending chime' },
  { value: 'approval', label: 'Fanfare',        description: 'Celebratory four-note rise' },
  { value: 'success',  label: 'Quick Rise',     description: 'Short upward confirmation' },
  { value: 'error',    label: 'Low Descend',    description: 'Low descending alert' },
];

const EVENT_ROWS: {
  event: AdminNotificationEvent;
  label: string;
  description: string;
  Icon: React.FC<{ className?: string }>;
  iconClass: string;
}[] = [
  {
    event: 'visitor',
    label: 'New Visitor',
    description: 'Someone lands on the site',
    Icon: User,
    iconClass: 'text-cyan-400',
  },
  {
    event: 'receipt',
    label: 'Receipt Upload',
    description: 'User uploads a deposit receipt',
    Icon: Upload,
    iconClass: 'text-amber-400',
  },
  {
    event: 'alert',
    label: 'Case / Alert',
    description: 'New case, document or submission',
    Icon: Bell,
    iconClass: 'text-rose-400',
  },
  {
    event: 'message',
    label: 'New Message',
    description: 'Incoming chat message',
    Icon: MessageCircle,
    iconClass: 'text-blue-400',
  },
  {
    event: 'approval',
    label: 'Approval',
    description: 'Admin approves something on a case',
    Icon: CheckCircle2,
    iconClass: 'text-emerald-400',
  },
];

export function SoundSettingsPanel({ onBack }: Props) {
  const { prefs, setPrefs, resetPrefs } = useNotificationPrefs();
  const [previewingEvent, setPreviewingEvent] = useState<AdminNotificationEvent | 'master' | null>(null);

  const preview = useCallback((tone: NotificationSoundType, tag: AdminNotificationEvent | 'master') => {
    setPreviewingEvent(tag);
    void playNotificationSound(tone, prefs.volume).then(() => {
      setTimeout(() => setPreviewingEvent(null), 800);
    });
  }, [prefs.volume]);

  const setTone = (event: AdminNotificationEvent, tone: NotificationSoundType) => {
    setPrefs({ ...prefs, tones: { ...prefs.tones, [event]: tone } });
  };

  const pct = Math.round(prefs.volume * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-slate-400 hover:text-white"
          data-testid="sound-settings-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div>
          <h2 className="text-xl font-bold text-white">Sound Notifications</h2>
          <p className="text-sm text-slate-400">Control alert volume, tones and per-event assignment</p>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={resetPrefs}
            className="border-slate-700 text-slate-400 hover:text-white"
            data-testid="sound-settings-reset"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset defaults
          </Button>
        </div>
      </div>

      {/* Master controls */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {prefs.enabled
              ? <Volume2 className="h-5 w-5 text-emerald-400" />
              : <VolumeX className="h-5 w-5 text-slate-500" />}
            <div>
              <p className="text-sm font-medium text-white">Sound alerts</p>
              <p className="text-xs text-slate-500">Play a tone on each admin notification</p>
            </div>
          </div>
          <Switch
            checked={prefs.enabled}
            onCheckedChange={(v) => setPrefs({ ...prefs, enabled: v })}
            data-testid="sound-settings-enabled"
          />
        </div>

        <div className={prefs.enabled ? '' : 'opacity-40 pointer-events-none'}>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm text-slate-300">Master volume</Label>
            <div className="flex items-center gap-2">
              <Badge className="bg-slate-800 text-slate-200 font-mono text-xs min-w-[3rem] text-center">
                {pct}%
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-slate-400 hover:text-white"
                disabled={previewingEvent === 'master'}
                onClick={() => preview(prefs.tones.alert, 'master')}
                data-testid="sound-settings-test-volume"
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                {previewingEvent === 'master' ? 'Playing…' : 'Test'}
              </Button>
            </div>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[pct]}
            onValueChange={([v]) => setPrefs({ ...prefs, volume: v / 100 })}
            className="w-full"
            data-testid="sound-settings-volume-slider"
          />
          <div className="flex justify-between text-[10px] text-slate-600 mt-1">
            <span>Silent</span>
            <span>Full</span>
          </div>
        </div>
      </div>

      {/* Per-event tone table */}
      <div className={`rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden ${!prefs.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="px-5 py-3 border-b border-slate-800">
          <p className="text-sm font-medium text-slate-300">Per-event tone assignment</p>
          <p className="text-xs text-slate-500 mt-0.5">Pick which sound each event plays — click ▶ to preview at current volume</p>
        </div>
        <div className="divide-y divide-slate-800/60">
          {EVENT_ROWS.map(({ event, label, description, Icon, iconClass }) => (
            <div
              key={event}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-800/30 transition-colors"
              data-testid={`sound-event-row-${event}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <Icon className={`h-4 w-4 ${iconClass}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-slate-500 truncate">{description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Select
                  value={prefs.tones[event]}
                  onValueChange={(v) => setTone(event, v as NotificationSoundType)}
                >
                  <SelectTrigger
                    className="w-44 bg-slate-800/80 border-slate-700 text-slate-200 text-sm h-8"
                    data-testid={`sound-tone-select-${event}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    {TONE_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className="text-slate-200 focus:bg-slate-800 focus:text-white"
                      >
                        <span className="font-medium">{opt.label}</span>
                        <span className="ml-2 text-slate-500 text-xs">{opt.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-700"
                  disabled={previewingEvent === event}
                  onClick={() => preview(prefs.tones[event], event)}
                  data-testid={`sound-preview-${event}`}
                  title={`Preview ${label} tone`}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>

                {prefs.tones[event] !== DEFAULT_PREFS.tones[event] && (
                  <Badge className="bg-amber-500/15 text-amber-300 text-[10px]">
                    Custom
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tone reference */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Available tones</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => void playNotificationSound(opt.value, prefs.volume)}
              className="flex flex-col items-start gap-0.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 px-3 py-2 text-left transition-all group"
              data-testid={`sound-tone-preview-${opt.value}`}
            >
              <span className="text-sm font-medium text-white group-hover:text-amber-300 transition-colors flex items-center gap-1.5">
                <Play className="h-3 w-3 opacity-60" />
                {opt.label}
              </span>
              <span className="text-[11px] text-slate-500">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
