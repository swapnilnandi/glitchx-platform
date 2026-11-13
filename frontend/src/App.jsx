import { Routes, Route } from "react-router-dom";

import Home from "./pages/home.jsx";
import Register from "./pages/register.jsx";
import Login from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx";
import Interview from "./pages/interview.jsx";
import MyInterviews from "./pages/myinterview.jsx";
import Report from "./pages/report.jsx";

export default function App() {
  return (
    <div className="app-container">
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />

        {/* User Dashboard */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Live Active Interview Session */}
        <Route path="/interview/:interviewId" element={<Interview />} />

        {/* Past Interview History */}
        <Route path="/my-interviews" element={<MyInterviews />} />
        <Route path="/Myinterview" element={<MyInterviews />} />

        {/* Full Detailed Evaluation Report (Where marks were cut, ideal answers, etc.) */}
        <Route path="/report/:interviewId" element={<Report />} />
      </Routes>
    </div>
  );
}