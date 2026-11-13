import React from 'react';
import { Link } from 'react-router-dom';

import { 
  Sparkles, 
  MessageSquare, 
  TrendingUp, 
  Briefcase, 
  ShieldCheck, 
  ArrowRight, 
  Clock, 
  Lightbulb, 
  Award, 
  Target, 
  Star 
} from 'lucide-react';

export default function App() {
  // Mock waveform heights for the audio visualizer
  const waveformBars = [
    12, 24, 18, 32, 45, 20, 15, 38, 55, 70, 40, 25, 60, 85, 95, 65, 45, 30, 
    75, 90, 100, 80, 50, 35, 65, 85, 95, 70, 40, 25, 50, 75, 90, 60, 35, 
    20, 45, 65, 80, 55, 30, 15, 40, 60, 70, 50, 25, 12
  ];

  return (
    <div className="min-h-screen w-full bg-[#070913] text-slate-100 font-sans selection:bg-purple-500 selection:text-white pb-20 overflow-x-hidden">
      
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute top-1/3 right-10 w-[500px] h-[500px] bg-pink-600/10 rounded-full blur-[140px] pointer-events-none"></div>

      {/* Main Hero Container */}
      <div className="max-w-7xl mx-auto px-6 pt-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative z-10">
        
        {/* Left Column: Branding & Value Proposition */}
        <div className="lg:col-span-5 space-y-8">
          <div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight uppercase bg-gradient-to-r from-pink-500 via-purple-400 to-indigo-400 bg-clip-text text-transparent leading-tight drop-shadow-sm">
              DEMO INTERVIEW PLATFORM
            </h1>
            <p className="text-slate-400 text-base md:text-lg mt-4 leading-relaxed">
              Practice real interviews, get instant feedback and improve your skills to <span className="text-pink-400 font-medium">land your dream job</span>.
            </p>
          </div>

          {/* Feature Bullets */}
          <div className="space-y-4">
            <div className="flex items-start space-x-4">
              <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Realistic Interview Experience</h3>
                <p className="text-xs text-slate-400">Simulate real company interviews with AI.</p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="p-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Instant AI Feedback</h3>
                <p className="text-xs text-slate-400">Get detailed feedback on your answers, communication & confidence.</p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Track & Improve</h3>
                <p className="text-xs text-slate-400">Track your performance over time and improve every day.</p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Land Your Dream Job</h3>
                <p className="text-xs text-slate-400">Build confidence, improve skills and crack top companies.</p>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link to='/register'>
            <button className="px-7 py-3.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:opacity-95 text-white font-semibold rounded-xl shadow-[0_0_25px_rgba(168,85,247,0.4)] transition duration-200 flex items-center space-x-2 text-sm">
                    <span>Sign Up Now</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            </Link>
            <Link to='/login'>
            <button className="px-7 py-3.5 bg-slate-900/80 hover:bg-slate-800 text-white font-semibold rounded-xl border border-purple-500/30 hover:border-purple-500/60 shadow-lg transition duration-200 flex items-center space-x-2 text-sm">
              <span>Log In</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            </Link>
            
          </div>

          {/* Trust Badge */}
          <div className="flex items-center space-x-2 text-xs text-slate-400 pt-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Trusted by 50K+ students and professionals worldwide</span>
          </div>
        </div>

        {/* Right Column: AI Interview Session Dashboard Card Mockup */}
        <div className="lg:col-span-7">
          <div className="bg-[#111320]/90 backdrop-blur-2xl rounded-3xl border border-purple-500/30 p-6 md:p-8 shadow-[0_0_50px_rgba(147,51,234,0.15)] relative">
            
            {/* Session Header */}
            <div className="flex items-center justify-between pb-6 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-semibold text-white tracking-wide">AI Interview Session</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
                  Live
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-xs text-slate-400 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                <span>24:30</span>
              </div>
            </div>

            {/* Question & Audio Visualizer Section */}
            <div className="py-6 space-y-4">
              <div className="inline-block px-3 py-1 rounded-md bg-purple-500/10 text-purple-300 text-[11px] font-medium border border-purple-500/20">
                Question
              </div>
              <h2 className="text-lg md:text-xl font-medium text-white">
                Introduce Yourself
              </h2>

              {/* Waveform Visualizer */}
              <div className="h-16 bg-slate-950/60 rounded-2xl border border-slate-800/80 px-6 flex items-center justify-between gap-1 overflow-hidden relative">
                <div className="absolute left-4 top-2 text-[10px] text-pink-400/80 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-pink-500 animate-ping"></span>
                  <span>Listening...</span>
                </div>
                <div className="w-full flex items-center justify-center gap-[3px] pt-4">
                  {waveformBars.map((height, index) => (
                    <div 
                      key={index} 
                      style={{ height: `${Math.max(height * 0.45, 8)}px` }} 
                      className={`w-1 rounded-full transition-all duration-300 ${
                        index % 3 === 0 ? 'bg-pink-500' : index % 2 === 0 ? 'bg-purple-500' : 'bg-indigo-400'
                      }`}
                    ></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-2">
              <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                  <Lightbulb className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Clarity</span>
                </div>
                <div className="text-xl font-bold text-white">8.5 <span className="text-xs font-normal text-slate-500">/10</span></div>
              </div>

              <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                  <Target className="w-3.5 h-3.5 text-purple-400" />
                  <span>Depth</span>
                </div>
                <div className="text-xl font-bold text-white">8.2 <span className="text-xs font-normal text-slate-500">/10</span></div>
              </div>

              <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                  <span>Confidence</span>
                </div>
                <div className="text-xl font-bold text-white">8.7 <span className="text-xs font-normal text-slate-500">/10</span></div>
              </div>

              <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-slate-400 text-xs mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                  <span>Communication</span>
                </div>
                <div className="text-xl font-bold text-white">8.4 <span className="text-xs font-normal text-slate-500">/10</span></div>
              </div>
            </div>

            {/* AI Feedback & Overall Score Box */}
            <div className="mt-4 bg-slate-950/60 rounded-2xl p-5 border border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="space-y-1.5 w-full">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">AI Feedback</h4>
                <p className="text-sm text-slate-200 font-medium">Great start! Your approach is clear.</p>
                <p className="text-xs text-slate-400">Try to cover more edge cases and trade-offs.</p>
              </div>

              {/* Circular Score Badge Simulation */}
              <div className="relative flex items-center justify-center shrink-0">
                <div className="w-20 h-20 rounded-full flex flex-col items-center justify-center bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-500 p-[2px] shadow-[0_0_15px_rgba(236,72,153,0.3)]">
                  <div className="w-full h-full bg-slate-950 rounded-full flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-white">84</span>
                    <span className="text-[9px] text-slate-400 uppercase tracking-tighter">/100</span>
                  </div>
                </div>
                <div className="absolute -top-1 text-[9px] font-semibold text-purple-300 bg-slate-900 px-2 py-0.5 rounded-full border border-purple-500/30">
                  Overall Score
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* Bottom Promotional Banner Section */}
      <div className="max-w-7xl mx-auto px-6">
          {/* Three Feature Cards Inside Bottom Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 pt-8 border-t border-slate-800/80">
            <div className="flex items-start space-x-4">
              <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Target className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Get Job Ready</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">Practice with role specific questions from top companies.</p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Track Your Progress</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">Detailed analytics to help you improve every day.</p>
              </div>
            </div>

            <div className="flex items-start space-x-4">
              <div className="p-3 rounded-2xl bg-pink-500/10 text-pink-400 border border-pink-500/20">
                <Star className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Boost Your Confidence</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">Realistic interview experience to help you stay calm and confident.</p>
              </div>
            </div>
          </div>

        </div>
      

      {/* Footer Text */}
      <div className="text-center text-xs text-slate-500 mt-12">
        Start practicing today and take the next step toward your dream job.
      </div>

    </div>
  );
}
