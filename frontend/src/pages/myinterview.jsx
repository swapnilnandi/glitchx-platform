import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Briefcase, 
  Award, 
  Star, 
  ChevronRight, 
  CheckCircle2, 
  Clock, 
  SlidersHorizontal,
  Loader2
} from 'lucide-react';
import { API_URL } from "../config";

export default function MyInterviews() {
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchInterviewHistory();
  }, []);

  const fetchInterviewHistory = async () => {
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');

      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${API_URL}/interviews/history`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.message || 'Failed to fetch interview history.');
      }

      const rawList = data.interviews || (Array.isArray(data) ? data : []);

      // STRICT TAB ISOLATION:
      // Never show in-progress or currently active interviews opened in another tab.
      const completedOnly = rawList.filter((item) => {
        return (
          item.completed === true &&
          item.interview_active !== true
        );
      });

      const sortedList = [...completedOnly].sort((a, b) => {
        const dateA = new Date(a.completed_at || a.date || a.created_at || 0).getTime();
        const dateB = new Date(b.completed_at || b.date || b.created_at || 0).getTime();
        return dateB - dateA;
      });

      setInterviews(sortedList);

    } catch (err) {
      console.error('Error fetching interviews:', err);
      setError(err.message || 'Unable to load interview history.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewReport = (interviewId) => {
    if (!interviewId) return;
    navigate(`/report/${interviewId}`);
  };

  return (
    <div className="min-h-screen w-full bg-[#070913] text-slate-100 font-sans p-4 md:p-10 flex flex-col items-center relative overflow-hidden">

      {/* Background Glow Ambiance */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none"></div>

      {/* Header Title */}
      <header className="w-full max-w-2xl text-center mb-8 relative z-10">
        <h1 className="text-2xl md:text-4xl font-black uppercase tracking-wider bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent">
          My Interviews
        </h1>
        <p className="text-slate-400 text-xs md:text-sm mt-1">
          Review your completed mock sessions, scores out of 80, and performance metrics.
        </p>
      </header>

      {/* Loading & Error States */}
      {loading && (
        <div className="flex items-center justify-center space-x-2 text-purple-400 py-12 relative z-10">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm font-medium">Loading completed interviews...</span>
        </div>
      )}

      {error && (
        <div className="w-full max-w-2xl mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center relative z-10">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && interviews.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-12 relative z-10">
          No past interviews found. Once your ongoing interview completes, it will appear here.
        </div>
      )}

      {/* Interviews List Container */}
      <main className="w-full max-w-2xl space-y-6 relative z-10">
        {!loading && interviews.map((item, index) => {
          const interviewId = item.interview_id || item.id || item._id;
          const interviewNumber = interviews.length - index;

          let scoreDisplay = 'N/A';
          if (item.total_score !== undefined) {
            scoreDisplay = `${item.total_score} / 80`;
          } else if (item.total_earned !== undefined) {
            scoreDisplay = `${item.total_earned} / 80`;
          } else if (item.percentage !== undefined && item.percentage > 0) {
            scoreDisplay = `${Math.round((item.percentage / 100) * 80)} / 80 (${item.percentage}%)`;
          }

          return (
            <div 
              key={interviewId || index} 
              className="w-full bg-[#111320]/90 backdrop-blur-xl rounded-3xl border border-purple-500/30 p-6 md:p-8 shadow-[0_0_30px_rgba(147,51,234,0.08)] transition hover:border-purple-500/60 flex flex-col space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <span className="text-xs md:text-sm font-extrabold text-purple-400 uppercase tracking-wide">
                  {`Interview #${interviewNumber}`}
                </span>
                <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Completed</span>
                </span>
              </div>

              <div className="flex items-center space-x-3 text-slate-200">
                <Briefcase className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="text-sm md:text-base font-bold">
                  <span className="text-slate-400 font-normal mr-2">Role:</span>
                  {item.role || 'Software Engineer'}
                </div>
              </div>

              <div className="flex items-center space-x-3 text-slate-300">
                <SlidersHorizontal className="w-4 h-4 text-pink-400 shrink-0" />
                <div className="text-xs md:text-sm font-medium">
                  <span className="text-slate-400 font-normal mr-2">Difficulty:</span>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                    item.difficulty === 'Hard' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                    item.difficulty === 'Medium' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                    'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}>
                    {item.difficulty || 'Medium'}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-slate-300">
                <Clock className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="text-xs md:text-sm font-medium">
                  <span className="text-slate-400 font-normal mr-2">Date:</span>
                  {item.completed_at || item.date || item.created_at ? 
                    new Date(item.completed_at || item.date || item.created_at).toLocaleDateString() : 'N/A'}
                </div>
              </div>

              <div className="flex items-center space-x-3 text-slate-300">
                <Award className="w-4 h-4 text-purple-400 shrink-0" />
                <div className="text-xs md:text-sm font-medium">
                  <span className="text-slate-400 font-normal mr-2">Total Score (Out of 80):</span>
                  <span className="text-purple-300 font-extrabold text-sm md:text-base">
                    {scoreDisplay}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-slate-300">
                <Star className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="text-xs md:text-sm font-medium">
                  <span className="text-slate-400 font-normal mr-2">Performance Rating:</span>
                  <span className="text-amber-300 font-bold">
                    {item.rating || 'Evaluated'}
                  </span>
                </div>
              </div>

              <div className="pt-3">
                <button 
                  onClick={() => handleViewReport(interviewId)}
                  className="w-full py-3 px-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white font-semibold rounded-xl text-xs md:text-sm shadow-md transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <span>GET FULL REPORT</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

            </div>
          );
        })}
      </main>

    </div>
  );
}