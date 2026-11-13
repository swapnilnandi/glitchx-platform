import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Award, 
  Star, 
  CheckCircle2, 
  ArrowLeft, 
  AlertCircle, 
  Lightbulb, 
  Sparkles, 
  Clock, 
  SlidersHorizontal,
  Briefcase,
  Loader2,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import { API_URL } from "../config";

export default function Report() {
  const { interviewId } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Checking evaluation status...');
  const [error, setError] = useState('');

  const pollIntervalRef = useRef(null);

  useEffect(() => {
    fetchReport();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [interviewId]);

  const fetchReport = async () => {
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${API_URL}/interviews/report/${interviewId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.message || 'Failed to load report.');
      }

      if (data.status === 'processing') {
        setIsProcessing(true);
        setStatusMessage(data.message || 'AI is currently evaluating your interview responses. Please wait...');
        
        // If not already polling, start polling every 3 seconds
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(() => {
            fetchReport();
          }, 3000);
        }
        return;
      }

      // Report successfully generated
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      setReport(data.report || data);
      setIsProcessing(false);
      setError('');
    } catch (err) {
      console.error('Error loading report:', err);
      if (!pollIntervalRef.current) {
        setError(err.message || 'Unable to load interview report.');
        setIsProcessing(false);
      }
    }
  };

  // ----------------------------------------------------
  // WAITING SCREEN: If report is generating in background
  // ----------------------------------------------------
  if (isProcessing) {
    return (
      <div className="min-h-screen w-full bg-[#070913] text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-purple-600/15 rounded-full blur-[160px] pointer-events-none" />

        <div className="max-w-md w-full bg-[#111320]/90 backdrop-blur-2xl rounded-3xl border border-purple-500/30 p-8 shadow-2xl text-center space-y-6 relative z-10">
          <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/20 animate-ping" />
            <div className="w-16 h-16 rounded-full bg-purple-500/10 border-2 border-purple-400 flex items-center justify-center text-purple-400">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-wide">
              Evaluating Interview Responses
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {statusMessage}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300 flex items-center justify-center space-x-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
            <span>Calculating marks out of 80 & compiling critique...</span>
          </div>

          <button
            onClick={() => navigate('/my-interviews')}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Check Later in My Interviews
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // ERROR SCREEN
  // ----------------------------------------------------
  if (error || !report) {
    return (
      <div className="min-h-screen w-full bg-[#070913] text-slate-100 flex flex-col items-center justify-center p-6 space-y-4">
        <p className="text-red-400 text-sm">{error || 'Report not found.'}</p>
        <button 
          onClick={() => navigate('/my-interviews')}
          className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-xl text-xs font-semibold transition"
        >
          Back to My Interviews
        </button>
      </div>
    );
  }

  // Questions list (includes Question 0 Intro + Questions 1 to 7)
  const questionsList = report.questions || report.questions_analysis || [];

  const totalEarnedScore = report.total_score !== undefined
    ? report.total_score
    : report.total_earned !== undefined
    ? report.total_earned
    : report.percentage !== undefined
    ? Math.round((report.percentage / 100) * 80)
    : 0;

  return (
    <div className="min-h-screen w-full bg-[#070913] text-slate-100 font-sans p-4 md:p-10 flex flex-col items-center relative overflow-hidden">
      
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[450px] bg-purple-600/10 rounded-full blur-[160px] pointer-events-none"></div>

      <div className="w-full max-w-4xl relative z-10 space-y-8">
        
        {/* Navigation & Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/my-interviews')}
            className="flex items-center space-x-2 text-xs md:text-sm font-semibold text-slate-400 hover:text-white transition px-3.5 py-2 rounded-xl bg-slate-900/60 border border-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to My Interviews</span>
          </button>
          <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
            Evaluation Complete
          </span>
        </div>

        {/* Hero Card / Overall Performance */}
        <div className="w-full bg-[#111320]/90 backdrop-blur-xl rounded-3xl border border-purple-500/30 p-6 md:p-8 shadow-[0_0_40px_rgba(147,51,234,0.12)] space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-black uppercase tracking-wide bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent">
                Interview Performance Report
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                <span className="flex items-center space-x-1"><Briefcase className="w-3.5 h-3.5 text-indigo-400" /> <span>{report.role}</span></span>
                <span>•</span>
                <span className="flex items-center space-x-1"><SlidersHorizontal className="w-3.5 h-3.5 text-pink-400" /> <span>{report.difficulty}</span></span>
                <span>•</span>
                <span className="flex items-center space-x-1"><Clock className="w-3.5 h-3.5 text-blue-400" /> <span>{report.completed_at ? new Date(report.completed_at).toLocaleDateString() : 'Today'}</span></span>
              </div>
            </div>

            {/* Total Marks Out of 80 Badge */}
            <div className="flex items-center space-x-4 bg-slate-950/60 px-5 py-3.5 rounded-2xl border border-purple-500/30 shrink-0">
              <Award className="w-8 h-8 text-purple-400" />
              <div>
                <p className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">Total Score</p>
                <p className="text-2xl font-black text-white">
                  {totalEarnedScore} <span className="text-slate-500 text-sm font-normal">/ 80</span>
                </p>
                <span className="text-[11px] font-semibold text-purple-300">
                  {report.percentage !== undefined ? `${report.percentage}% Overall` : ''}
                </span>
              </div>
              <div className="border-l border-slate-800 pl-4">
                <p className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">Rating</p>
                <p className="text-sm font-bold text-amber-300">{report.rating || 'Evaluated'}</p>
              </div>
            </div>
          </div>

          {/* Executive Summary */}
          {report.summary && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400">Executive Summary</h3>
              <p className="text-xs md:text-sm text-slate-300 leading-relaxed">{report.summary}</p>
            </div>
          )}

          {/* Strengths & Areas to Improve Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {report.strengths && report.strengths.length > 0 && (
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Key Strengths</span>
                </h4>
                <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                  {report.strengths.map((str, idx) => (
                    <li key={idx}>{str}</li>
                  ))}
                </ul>
              </div>
            )}

            {report.areas_for_improvement && report.areas_for_improvement.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center space-x-1.5">
                  <AlertCircle className="w-4 h-4" />
                  <span>Areas For Improvement</span>
                </h4>
                <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                  {report.areas_for_improvement.map((area, idx) => (
                    <li key={idx}>{area}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Question-by-Question Detailed Breakdown (Intro + Q1 through Q7) */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg md:text-xl font-bold uppercase tracking-wider text-white">
              Detailed Questions & Answers Breakdown
            </h2>
            <span className="text-xs text-slate-400">
              Introduction (10 marks) + 7 Questions (70 marks)
            </span>
          </div>

          {questionsList.map((q, index) => {
            const isIntro = q.step_type === 'intro' || q.question_number === 0;
            const qNumberLabel = isIntro ? 'Question #0 (Candidate Introduction)' : `Question #${q.question_number || index}`;
            const questionText = q.question || q.prompt || (isIntro ? 'Candidate Introduction & Technical Background Overview' : `Question ${index}`);

            return (
              <div 
                key={index}
                className="w-full bg-[#111320]/90 backdrop-blur-xl rounded-3xl border border-slate-800 p-6 md:p-7 space-y-5 hover:border-purple-500/40 transition shadow-lg"
              >
                {/* Question Header & Score Out of 10 */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
                  <div>
                    <span className={`text-xs font-extrabold uppercase tracking-wider ${isIntro ? 'text-indigo-400' : 'text-purple-400'}`}>
                      {qNumberLabel}
                    </span>
                    <h3 className="text-sm md:text-base font-semibold text-white mt-1">
                      {questionText}
                    </h3>
                  </div>
                  <div className="px-3.5 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-white font-black text-xs md:text-sm shrink-0">
                    {q.score !== undefined ? `${q.score} / 10` : 'N/A'}
                  </div>
                </div>

                {/* Candidate's Response */}
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Candidate's Response:</p>
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs md:text-sm text-slate-200">
                    "{q.candidate_answer || q.answer || 'No answer recorded.'}"
                  </div>
                </div>

                {/* Assessment Breakdown: Mistakes Deducted & Improvements */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  {/* Where Marks Were Deducted / Mistakes */}
                  <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-red-400 font-bold text-xs uppercase tracking-wide">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Where You Made Mistakes / Marks Deducted</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {q.where_marks_deducted || q.mistakes || 'Omitted specific technical nuances or missed key trade-offs.'}
                    </p>
                  </div>

                  {/* How to Improve & Correct */}
                  <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-indigo-400 font-bold text-xs uppercase tracking-wide">
                      <Lightbulb className="w-4 h-4 shrink-0" />
                      <span>How You Can Correct This</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {q.how_to_improve || q.how_to_correct || 'Structure your response clearly with concrete examples, edge cases, and industry patterns.'}
                    </p>
                  </div>
                </div>

                {/* Ideal Model Answer */}
                {(q.ideal_answer || isIntro) && (
                  <div className="p-4 rounded-2xl bg-purple-500/5 border border-purple-500/20 space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-purple-400 font-bold text-xs uppercase tracking-wide">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>Ideal Answer / Master Approach</span>
                    </div>
                    <p className="text-xs text-purple-200/90 leading-relaxed italic">
                      "{q.ideal_answer || 'Present a concise elevator pitch: current expertise, key production achievements, and relevant competencies.'}"
                    </p>
                  </div>
                )}

              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}