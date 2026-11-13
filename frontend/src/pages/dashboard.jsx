import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Upload,
  Briefcase,
  ShieldCheck,
  ArrowRight,
  Target,
  TrendingUp,
  Lightbulb,
  FileText,
  Sliders
} from 'lucide-react';
import { API_URL } from "../config";
import Instructions from "./instructions.jsx";

export default function Dashboard() {
  const navigate = useNavigate();

  const [role, setRole] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [resumeFile, setResumeFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);


  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setResumeFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setResumeFile(e.dataTransfer.files[0]);
    }
  };

  // Step 1: the form only validates, then shows the instruction page.
  const handleSubmit = (e) => {
    e.preventDefault();

    if (!resumeFile) {
      alert('Please upload your resume to continue.');
      return;
    }

    if (!role.trim()) {
      alert('Please enter your target role.');
      return;
    }

    setShowInstructions(true);
  };

  // Step 2: runs only after the user ticked "I have read the instructions" and submitted.
  const startInterview = async () => {
    setLoading(true);

    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');

      if (!token) {
        alert('You are not logged in. Please log in again.');
        navigate('/login');
        return;
      }

      const formData = new FormData();
      formData.append('resume', resumeFile);
      formData.append('role', role);
      formData.append('difficulty', difficulty);

      const response = await fetch(`${API_URL}/interviews/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
          data.message ||
          'Failed to start interview session.'
        );
      }

      const interviewId = data.interview_id || data.id;

      if (!interviewId) {
        throw new Error('Backend did not return an interview ID.');
      }

      // TAB ISOLATION: store active session in sessionStorage so it does NOT affect other tabs
      sessionStorage.setItem('active_interview_id', interviewId);

      navigate(`/interview/${interviewId}`);

    } catch (error) {
      console.error('Error starting interview:', error);
      alert(error.message || 'Failed to start the interview session.');
    } finally {
      setLoading(false);
    }
  };

  const handleMyInterviews = () => {
    navigate('/my-interviews');
  };

  if (showInstructions) {
    return (
      <Instructions
        role={role.trim()}
        difficulty={difficulty}
        resumeName={resumeFile ? resumeFile.name : ''}
        loading={loading}
        onBack={() => setShowInstructions(false)}
        onAccept={startInterview}
      />
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#070913] text-slate-100 font-sans selection:bg-purple-500 selection:text-white p-4 md:p-8 flex flex-col items-center relative overflow-hidden">

      {/* Background Glow Ambiance */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none"></div>
      <div className="absolute bottom-10 right-10 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[130px] pointer-events-none"></div>

      {/* Top Navbar */}
      <nav className="w-full max-w-4xl flex items-center justify-between mb-10 relative z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
            <User className="w-5 h-5"/>
          </div>

          <div>
            <h1 className="text-xs font-bold uppercase tracking-wider text-slate-400 leading-tight">
              Demo Interview
            </h1>
            <span className="text-sm font-extrabold text-white tracking-wide">
              Platform
            </span>
          </div>
        </div>

        <div 
          onClick={handleMyInterviews}
          title="View My Past Interviews"
          className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:border-purple-500/50 hover:text-white transition cursor-pointer"
        >
          <User className="w-4 h-4"/>
        </div>
      </nav>

      {/* Hero Banner */}
      <div className="text-center max-w-2xl mx-auto space-y-4 mb-10 relative z-10">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#131629] border border-purple-500/30 flex items-center justify-center shadow-lg shadow-purple-500/10 text-purple-400">
          <User className="w-7 h-7"/>
        </div>

        <h2 className="text-3xl md:text-5xl font-black tracking-tight uppercase bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent leading-tight">
          DEMO INTERVIEW
          <br/>
          PLATFORM
        </h2>

        <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-lg mx-auto">
          You have come to the right place to test and improve your interview
          skills with AI-powered mock interviews.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-900/85 border border-slate-800 text-xs text-slate-300">
            <Target className="w-3.5 h-3.5 text-purple-400"/>
            <span>Realistic Questions</span>
          </div>

          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-900/85 border border-slate-800 text-xs text-slate-300">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-400"/>
            <span>Smart Evaluation</span>
          </div>

          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-900/85 border border-slate-800 text-xs text-slate-300">
            <Lightbulb className="w-3.5 h-3.5 text-pink-400"/>
            <span>Personalized Feedback</span>
          </div>
        </div>
      </div>

      {/* Main Start Form */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl bg-[#111320]/90 backdrop-blur-2xl rounded-3xl border border-purple-500/30 p-6 md:p-10 shadow-[0_0_50px_rgba(147,51,234,0.12)] space-y-8 relative z-10"
      >
        {/* Section 1: Resume Upload */}
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Upload className="w-5 h-5"/>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Upload Your Resume
              </h3>
              <p className="text-xs text-slate-400">
                Upload your latest resume (PDF/DOCX) to get started.
              </p>
            </div>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition flex flex-col items-center justify-center relative bg-slate-950/40 ${
              isDragging
                ? 'border-purple-500 bg-purple-500/5'
                : 'border-purple-500/30 hover:border-purple-500/60'
            }`}
          >
            <input
              type="file"
              accept=".pdf,.docx"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-400 mb-3 border border-purple-500/20">
              <Upload className="w-6 h-6"/>
            </div>

            {resumeFile ? (
              <div className="flex items-center space-x-2 bg-purple-500/20 px-4 py-2 rounded-xl border border-purple-500/30 text-purple-300 text-sm font-medium">
                <FileText className="w-4 h-4"/>
                <span>{resumeFile.name}</span>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-200 mb-1">
                  Drag & drop your resume here
                </p>
                <p className="text-xs text-slate-500 mb-4">or</p>
                <button
                  type="button"
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-90 text-white font-semibold rounded-xl text-xs shadow-md transition pointer-events-none"
                >
                  Browse File
                </button>
                <p className="text-[11px] text-slate-500 mt-4">
                  Supported formats: PDF, DOCX (Max 5MB)
                </p>
              </>
            )}
          </div>
        </div>

        {/* Section 2: Role Input */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Briefcase className="w-5 h-5"/>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Enter the Role
              </h3>
              <p className="text-xs text-slate-400">
                Specify the role for which you want to practice.
              </p>
            </div>
          </div>

          <div className="relative">
            <input
              type="text"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Software Engineer, Data Scientist, Product Manager"
              className="w-full px-4 py-3.5 rounded-xl bg-slate-950/70 border border-purple-500/30 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition text-sm"
            />
          </div>
        </div>

        {/* Section 3: Difficulty Selection */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-pink-500/10 text-pink-400 border border-pink-500/20">
              <Sliders className="w-5 h-5"/>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Difficulty Level
              </h3>
              <p className="text-xs text-slate-400">
                Select how challenging you want the interview questions to be.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {['Easy', 'Medium', 'Hard'].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setDifficulty(level)}
                className={`py-3 px-4 rounded-xl text-xs md:text-sm font-semibold border transition cursor-pointer ${
                  difficulty === level
                    ? 'bg-purple-600/20 border-purple-500 text-white shadow-lg shadow-purple-500/20'
                    : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-purple-500/40 hover:text-slate-200'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Section 4: Action Buttons */}
        <div className="pt-4 space-y-4 text-center">
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white font-bold rounded-2xl shadow-[0_0_30px_rgba(147,51,234,0.4)] transition duration-200 flex items-center justify-center space-x-2 text-sm md:text-base cursor-pointer disabled:opacity-50"
          >
            <span>{loading ? 'Starting Interview...' : 'Start Interview'}</span>
            <ArrowRight className="w-5 h-5"/>
          </button>

          <div className="flex items-center justify-center space-x-2 text-xs text-slate-400 pt-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400"/>
            <span>Your data is secure and will not be shared.</span>
          </div>

          {/* MY INTERVIEWS BUTTON */}
          <button
            type="button"
            onClick={handleMyInterviews}
            className="w-full py-3.5 px-6 bg-slate-950/70 hover:bg-purple-500/10 border border-purple-500/30 hover:border-purple-500/60 text-slate-200 hover:text-white font-semibold rounded-2xl transition duration-200 flex items-center justify-center space-x-2 text-sm cursor-pointer shadow-sm hover:shadow-[0_0_20px_rgba(147,51,234,0.2)]"
          >
            <FileText className="w-4 h-4 text-purple-400"/>
            <span>My Interviews</span>
          </button>
        </div>

      </form>
    </div>
  );
}