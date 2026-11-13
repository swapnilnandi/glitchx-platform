import React, { useState } from 'react';
import {
  Mic,
  Volume2,
  Clock,
  WifiOff,
  AlertTriangle,
  CheckCircle,
  FileText,
  ArrowRight,
  ShieldCheck,
  Target,
  Lightbulb,
  Loader2,
  XOctagon,
  RotateCcw
} from 'lucide-react';

/**
 * Instruction page shown after the user clicks "Start Interview" on the dashboard.
 * The interview is only created when the user ticks the box and presses "Proceed".
 *
 * Props:
 *   role, difficulty, resumeName : shown in a small summary card
 *   loading                      : true while the interview session is being created
 *   onBack()                     : go back to the dashboard form
 *   onAccept()                   : called when the tick box is checked and the user submits
 */
function Section({ icon, title, color, children }) {
  return (
    <section className="rounded-2xl bg-slate-950/50 border border-slate-800 p-5 space-y-3">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-xl border ${color}`}>{icon}</div>
        <h3 className="text-base font-bold text-white">{title}</h3>
      </div>
      <ul className="space-y-2 text-sm text-slate-300 leading-relaxed list-disc pl-5 marker:text-slate-500">
        {children}
      </ul>
    </section>
  );
}

export default function Instructions({ role, difficulty, resumeName, loading, onBack, onAccept }) {
  const [accepted, setAccepted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!accepted || loading) return;
    onAccept();
  };

  return (
    <div className="min-h-screen w-full bg-[#070913] text-slate-100 font-sans p-4 md:p-8 flex flex-col items-center relative overflow-hidden">
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none"></div>

      <div className="w-full max-w-3xl relative z-10 space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#131629] border border-purple-500/30 flex items-center justify-center text-purple-400">
            <FileText className="w-7 h-7" />
          </div>
          <h1 className="text-2xl md:text-4xl font-black tracking-tight uppercase bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent">
            Interview Instructions
          </h1>
          <p className="text-slate-400 text-sm max-w-xl mx-auto">
            Please read everything below carefully. The interview starts only after you confirm at the bottom of this page.
          </p>
        </div>

        {/* Summary of the user's choices */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Role</div>
            <div className="text-sm font-semibold text-white break-words">{role}</div>
          </div>
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Difficulty</div>
            <div className="text-sm font-semibold text-white">{difficulty}</div>
          </div>
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Resume</div>
            <div className="text-sm font-semibold text-white break-words">{resumeName}</div>
          </div>
        </div>

        <div className="space-y-4">
          <Section
            icon={<Lightbulb className="w-5 h-5" />}
            title="1. Get ready before you start"
            color="bg-amber-500/10 text-amber-400 border-amber-500/20"
          >
            <li>Sit in a <strong>quiet place</strong>. Background noise and other voices can disturb the speech recognition.</li>
            <li>Use an up-to-date <strong>Chrome or Edge</strong> browser on a laptop or desktop for the best result.</li>
            <li>Check your <strong>microphone and speaker volume</strong>. Headphones with a microphone work best and prevent echo.</li>
            <li>Make sure your <strong>internet connection is stable</strong> for the whole interview.</li>
            <li>Keep this interview in <strong>one browser tab only</strong>. Close other tabs that use the microphone (calls, recorders).</li>
            <li>Keep a glass of water nearby. Plan for <strong>up to one hour</strong> without interruption.</li>
          </Section>

          <Section
            icon={<Target className="w-5 h-5" />}
            title="2. How the interview works"
            color="bg-purple-500/10 text-purple-400 border-purple-500/20"
          >
            <li>The interview has <strong>8 parts</strong>: a short self-introduction followed by <strong>7 questions</strong>. Each part carries <strong>10 marks</strong>, so the total is <strong>80 marks</strong>.</li>
            <li>Questions 1-5 test the skills of your chosen role, question 6 is about your own experience or projects from your resume, and question 7 is a real-life scenario.</li>
            <li>Questions are based on your <strong>role, difficulty level and uploaded resume</strong>, so be ready to explain everything written on your resume.</li>
            <li>The interviewer may ask a <strong>follow-up question</strong> on some answers. When a follow-up is asked, your marks for that question are calculated as <strong>70% from the main answer and 30% from the follow-up</strong>.</li>
            <li>The interviewer <strong>speaks the question aloud</strong> and you <strong>answer by speaking</strong>. There is nothing to type.</li>
            <li>After this page you will enter the interview room. Click the <strong>Start Interview</strong> button there and <strong>allow the microphone</strong> when your browser asks.</li>
          </Section>

          <Section
            icon={<Mic className="w-5 h-5" />}
            title="3. How to answer by voice"
            color="bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          >
            <li>Wait until the interviewer <strong>finishes speaking</strong> (the speaker icon stops moving) and the microphone icon turns on, then start your answer.</li>
            <li>You must <strong>start speaking within 10 seconds</strong> (30 seconds for question 7). If you stay silent, the answer is recorded as <strong>"remained silent" and receives 0 marks</strong>.</li>
            <li>Your answer is <strong>submitted automatically</strong> after you pause for about <strong>4 seconds</strong> (2 seconds during the introduction). Do not take long pauses in the middle of an answer - think first, then speak in a continuous flow.</li>
            <li>Speak clearly, at a natural speed, and give <strong>complete answers with examples</strong>. Very short answers score low.</li>
            <li>After submitting, wait for <strong>"Evaluating response with AI..."</strong> to finish. Do not speak or click anything during this time.</li>
            <li>If an evaluation fails, a <strong>Retry Answer Submission</strong> button appears. Press it - your answer is not lost.</li>
          </Section>

          <Section
            icon={<Clock className="w-5 h-5" />}
            title="4. Time rules"
            color="bg-blue-500/10 text-blue-400 border-blue-500/20"
          >
            <li>Each question has a <strong>maximum of 7 minutes</strong>. If you reach this limit, the interview ends after that answer and the remaining questions are not asked.</li>
            <li>You can see the time left on the interview screen while you answer.</li>
          </Section>

          <Section
            icon={<WifiOff className="w-5 h-5" />}
            title="5. If your internet disconnects"
            color="bg-rose-500/10 text-rose-400 border-rose-500/20"
          >
            <li>If your connection drops, the interview <strong>pauses</strong> and a warning with a countdown is shown. The time you were offline is not counted against your question time.</li>
            <li>You have <strong>2 minutes</strong> to reconnect. If you are back in time, continue from the same question.</li>
            <li>If you stay offline for more than 2 minutes, the interview <strong>ends automatically</strong> and you are scored only on the questions already answered.</li>
          </Section>

          <Section
            icon={<AlertTriangle className="w-5 h-5" />}
            title="6. Important do's and don'ts"
            color="bg-orange-500/10 text-orange-400 border-orange-500/20"
          >
            <li><strong>Do not refresh, close or go back</strong> in the browser during the interview, and do not open the same interview in a second tab.</li>
            <li>Do not press the submit or retry button repeatedly. One click is enough.</li>
            <li>Answer in <strong>your own words</strong> and be honest about your experience. This is a practice tool: the feedback is only useful if the answers are really yours.</li>
            <li>You can use the <strong>End Interview</strong> button to stop early. After you confirm, the <strong>unanswered questions get 0 marks</strong> and the interview cannot be resumed.</li>
            <li>A completed interview cannot be repeated with the same session. Start a new one from the dashboard if you want another attempt.</li>
          </Section>

          <Section
            icon={<CheckCircle className="w-5 h-5" />}
            title="7. After the interview"
            color="bg-teal-500/10 text-teal-400 border-teal-500/20"
          >
            <li>Your final score out of 80 and your rating are shown when the interview completes.</li>
            <li>Open <strong>My Interviews</strong> to see the detailed report: marks for every question, where marks were lost, strengths, areas to improve and ideal answers.</li>
            <li>The detailed report is prepared in the background, so it can take a short while to appear. Refresh the report page after a moment if it is not ready.</li>
          </Section>

          <Section
            icon={<ShieldCheck className="w-5 h-5" />}
            title="8. Privacy and AI notice"
            color="bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
          >
            <li>Your <strong>resume text and your spoken answers</strong> are processed by AI services (Google Gemini) to convert speech to text, ask questions and score your answers.</li>
            <li>Scores and feedback are generated by AI. They are a <strong>practice guide, not an official or final judgement</strong>, and can sometimes be imperfect.</li>
            <li>Do not say or upload passwords, bank details or other sensitive personal information during the interview.</li>
          </Section>
        </div>

        {/* Confirmation */}
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-[#111320]/90 border border-purple-500/30 p-6 md:p-8 shadow-[0_0_50px_rgba(147,51,234,0.12)] space-y-5"
        >
          <label className="flex items-start space-x-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 w-5 h-5 accent-purple-600 cursor-pointer"
            />
            <span className="text-sm text-slate-200 leading-relaxed">
              I have read and understood all the instructions above and I want to proceed with the interview.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              className="sm:w-1/3 py-3.5 px-6 bg-slate-950/70 hover:bg-purple-500/10 border border-purple-500/30 hover:border-purple-500/60 text-slate-200 font-semibold rounded-2xl transition flex items-center justify-center space-x-2 text-sm cursor-pointer disabled:opacity-50"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              <span>Go Back</span>
            </button>

            <button
              type="submit"
              disabled={!accepted || loading}
              className="flex-1 py-3.5 px-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white font-bold rounded-2xl shadow-[0_0_30px_rgba(147,51,234,0.4)] transition flex items-center justify-center space-x-2 text-sm md:text-base cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Starting Interview...</span>
                </>
              ) : (
                <>
                  <span>Submit &amp; Start Interview</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          {!accepted && (
            <p className="text-xs text-slate-500 text-center">
              Tick the box above to enable the button.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
