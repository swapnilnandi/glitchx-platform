import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL } from "../config";

export default function Register() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    fullName: '',
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
      const response = await fetch(
        `${API_URL}/auth/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            full_name: formData.fullName, // Matches backend UserRegister schema
            email: formData.email,
            password: formData.password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
          data.message ||
          'Registration failed.'
        );
      }

      alert('Registration successful!');
      navigate('/login');

    } catch (error) {
      console.error('Registration error:', error);

      setError(
        error.message ||
        'Unable to create account.'
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
            Create Account
          </h2>

          <p className="text-xs text-slate-400 mt-2">
            Create your account to start practicing interviews.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Register Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Full Name
            </label>

            <input
              type="text"
              name="fullName"
              required
              value={formData.fullName}
              onChange={handleChange}
              placeholder="Jane Doe"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition text-sm disabled:opacity-50"
            />
          </div>

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
            {loading ? 'Creating Account...' : 'Sign Up'}
          </button>

        </form>

        {/* Login Link */}
        <div className="text-center mt-6 pt-4 border-t border-slate-800">

          <p className="text-[11px] text-slate-400">
            Already signed up?{' '}

            <Link
              to="/login"
              className="text-indigo-400 hover:text-indigo-300 hover:underline font-medium"
            >
              Go to login
            </Link>
          </p>

        </div>

      </div>
    </div>
  );
}