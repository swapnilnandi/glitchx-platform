import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL } from "../config";

export default function Login() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError('');
    setLoading(true);

    try {
      // FastAPI OAuth2PasswordRequestForm expects form-urlencoded data with 'username' and 'password'
      const details = new URLSearchParams();
      details.append('username', formData.email); // Map email to username for FastAPI form
      details.append('password', formData.password);

      const response = await fetch(
        `${API_URL}/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: details,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
          data.message ||
          'Login failed.'
        );
      }

      // Save JWT access token
      localStorage.setItem(
        'access_token',
        data.access_token
      );

      console.log('Login successful:', data);

      // Go to dashboard
      navigate('/dashboard');

    } catch (error) {
      console.error('Login error:', error);

      setError(
        error.message ||
        'Unable to login. Please try again.'
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">

      {/* Ambient background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none"></div>

      {/* Title */}
      <div className="text-center mb-6 relative z-10">
        <h1 className="text-2xl md:text-3xl font-black tracking-wider uppercase bg-gradient-to-r from-pink-500 via-purple-400 to-indigo-400 bg-clip-text text-transparent drop-shadow-md">
          DEMO INTERVIEW PLATFORM
        </h1>
      </div>

      {/* Form Card */}
      <div className="max-w-md w-full bg-slate-900/85 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-slate-800 relative z-10">

        {/* Heading */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-white">
            Welcome Back
          </h2>

          <p className="text-xs text-slate-400 mt-2">
            Login to continue to your interview platform.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Login Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Email Address
            </label>

            <input
              type="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="name@example.com"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition text-sm disabled:opacity-50"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Password
            </label>

            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition text-sm disabled:opacity-50"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold rounded-lg shadow-lg transition duration-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>

        </form>

        {/* Register Link */}
        <div className="text-center mt-6 pt-4 border-t border-slate-800">

          <p className="text-[11px] text-slate-400">
            Don't have an account?{' '}

            <Link
              to="/register"
              className="text-indigo-400 hover:text-indigo-300 hover:underline font-medium"
            >
              Sign up
            </Link>
          </p>

        </div>

      </div>
    </div>
  );
}