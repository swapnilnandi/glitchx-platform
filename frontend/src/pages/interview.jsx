import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    Mic,
    MicOff,
    Volume2,
    CheckCircle,
    Loader2,
    User,
    ArrowRight,
    FileText,
    Sparkles,
    RotateCcw,
    Radio,
    Clock,
    XOctagon,
    AlertTriangle,
    WifiOff
} from "lucide-react";
import { API_URL, WS_URL } from "../config";

const QUESTION_LIMIT_SECONDS = 420;
const DISCONNECT_LIMIT_SECONDS = 120;

function getAuthHeaders() {
    const token = localStorage.getItem("access_token") || localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Interview() {
    const { interviewId } = useParams();
    const navigate = useNavigate();

    const [currentPrompt, setCurrentPrompt] = useState("");
    const [remark, setRemark] = useState("");
    const [questionNumber, setQuestionNumber] = useState(0);
    const [stepType, setStepType] = useState("intro");
    const [roleTitle, setRoleTitle] = useState("");

    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [interviewStarted, setInterviewStarted] = useState(false);
    const [interviewComplete, setInterviewComplete] = useState(false);
    const [voiceStatusText, setVoiceStatusText] = useState("");
    const [initialSecondsLeft, setInitialSecondsLeft] = useState(null);
    const [pauseSecondsLeft, setPauseSecondsLeft] = useState(null);
    const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
    const [hasSubmissionError, setHasSubmissionError] = useState(false);
    const [isWsConnected, setIsWsConnected] = useState(false);

    const [questionTimeLeft, setQuestionTimeLeft] = useState(QUESTION_LIMIT_SECONDS);
    const questionTimerRef = useRef(null);

    const [showEndModal, setShowEndModal] = useState(false);
    const [confirmEndChecked, setConfirmEndChecked] = useState(false);
    const [isEndingInterview, setIsEndingInterview] = useState(false);

    const [isOffline, setIsOffline] = useState(false);
    const [disconnectSecondsLeft, setDisconnectSecondsLeft] = useState(DISCONNECT_LIMIT_SECONDS);
    const disconnectTimerRef = useRef(null);
    const disconnectStartRef = useRef(null);
    const isPausedDueToOfflineRef = useRef(false);

    const wsRef = useRef(null);
    const recorderRef = useRef(null);
    const audioChunksRef = useRef([]);

    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const microphoneStreamRef = useRef(null);
    const microphoneSourceRef = useRef(null);
    const analyserDataRef = useRef(null);

    const animationFrameRef = useRef(null);
    const lastVadSampleTimeRef = useRef(0);

    const activeUtteranceRef = useRef(null);
    const activeAudioElementRef = useRef(null);

    const noiseFloorRef = useRef(0.008);
    const speechFramesRef = useRef(0);
    const silenceFramesRef = useRef(0);
    const silenceStartedAtRef = useRef(null);
    const isVADRunningRef = useRef(false);

    const initialSilenceTimerRef = useRef(null);
    const initialCountdownRef = useRef(null);

    const voiceSessionIdRef = useRef(0);
    const ttsSessionIdRef = useRef(0);
    const answerTokenRef = useRef(0);

    const answerStartedAtRef = useRef(null);
    const lastSubmittedAnswerRef = useRef("");
    const lastSubmittedDurationRef = useRef(0);

    const hasStartedSpeakingRef = useRef(false);
    const answerHasSpeechRef = useRef(false);
    const processingAnswerRef = useRef(false);

    const interviewCompleteRef = useRef(false);
    const currentVoiceStatusRef = useRef("");
    const lastPauseSecRef = useRef(null);
    const lastInitialSecRef = useRef(null);

    const currentPromptRef = useRef("");
    const questionNumberRef = useRef(0);
    const stepTypeRef = useRef("intro");

    const recognitionRef = useRef(null);
    const liveTranscriptRef = useRef("");

    const listeningStartInProgressRef = useRef(false);
    const ttsFallbackTimerRef = useRef(null);

    useEffect(() => {
        currentPromptRef.current = currentPrompt;
    }, [currentPrompt]);

    useEffect(() => {
        questionNumberRef.current = questionNumber;
    }, [questionNumber]);

    useEffect(() => {
        stepTypeRef.current = stepType;
    }, [stepType]);

    useEffect(() => {
        interviewCompleteRef.current = interviewComplete;
    }, [interviewComplete]);

    const updateVoiceStatus = useCallback((text) => {
        if (currentVoiceStatusRef.current !== text) {
            currentVoiceStatusRef.current = text;
            setVoiceStatusText(text);
        }
    }, []);

    useEffect(() => {
        if (interviewId) {
            sessionStorage.setItem("active_interview_id", interviewId);
        }
        return () => {
            sessionStorage.removeItem("active_interview_id");
        };
    }, [interviewId]);

    // 7-MINUTE TIMER
    useEffect(() => {
        if (!interviewStarted || interviewComplete || isOffline) {
            if (questionTimerRef.current) {
                clearInterval(questionTimerRef.current);
                questionTimerRef.current = null;
            }
            return;
        }

        questionTimerRef.current = setInterval(() => {
            setQuestionTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(questionTimerRef.current);
                    handleQuestionTimeout();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            if (questionTimerRef.current) {
                clearInterval(questionTimerRef.current);
                questionTimerRef.current = null;
            }
        };
    }, [interviewStarted, interviewComplete, isOffline, questionNumber]);

    const handleQuestionTimeout = () => {
        console.warn("[Time Limit] 7-minute limit reached. Ending interview.");
        updateVoiceStatus("7-minute question limit reached. Ending interview...");
        processAndSubmitAnswer(false, QUESTION_LIMIT_SECONDS);
    };

    const resetQuestionTimer = () => {
        setQuestionTimeLeft(QUESTION_LIMIT_SECONDS);
    };

    // --------------------------------------------------
    // NETWORK DISCONNECT / RECONNECT MONITORING
    // --------------------------------------------------
    useEffect(() => {
        const handleOffline = () => {
            console.warn("[Network] Connection lost. Pausing interview.");
            setIsOffline(true);
            isPausedDueToOfflineRef.current = true;
            disconnectStartRef.current = Date.now();
            setDisconnectSecondsLeft(DISCONNECT_LIMIT_SECONDS);

            stopBrowserTTS();
            stopVAD();
            stopLiveRecognition();
            stopRecorderAndMic();

            try {
                // sendBeacon cannot add an Authorization header, so the token travels in the URL
                const beaconToken = localStorage.getItem("access_token") || localStorage.getItem("token") || "";
                const blob = new Blob([JSON.stringify({ interview_id: interviewId })], {
                    type: "text/plain"
                });
                navigator.sendBeacon(
                    `${API_URL}/interviews/disconnect-event?token=${encodeURIComponent(beaconToken)}`,
                    blob
                );
            } catch (e) {}

            if (disconnectTimerRef.current) clearInterval(disconnectTimerRef.current);
            disconnectTimerRef.current = setInterval(() => {
                setDisconnectSecondsLeft((prev) => {
                    if (prev <= 1) {
                        clearInterval(disconnectTimerRef.current);
                        handleDisconnectTimeout();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        };

        const handleDisconnectTimeout = async () => {
            console.error("[Network] Disconnected > 2 minutes. Finalizing interview.");
            try {
                await fetch(`${API_URL}/interviews/end`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...getAuthHeaders()
                    },
                    body: JSON.stringify({
                        interview_id: interviewId,
                        reason: "Network disconnected for more than 2 minutes"
                    })
                });
            } catch (err) {
                console.error("Timeout end failed:", err);
            }
            finishInterview();
        };

        const handleOnline = async () => {
            console.log("[Network] Connection restored. Synchronizing state.");
            if (disconnectTimerRef.current) {
                clearInterval(disconnectTimerRef.current);
                disconnectTimerRef.current = null;
            }

            const offlineDuration = disconnectStartRef.current
                ? Math.round((Date.now() - disconnectStartRef.current) / 1000)
                : 0;

            try {
                const res = await fetch(`${API_URL}/interviews/resume-connection`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...getAuthHeaders()
                    },
                    body: JSON.stringify({
                        interview_id: interviewId,
                        offline_seconds: offlineDuration
                    })
                });

                const data = await res.json();
                if (data.interview_complete) {
                    finishInterview();
                    return;
                }

                setIsOffline(false);
                isPausedDueToOfflineRef.current = false;
                disconnectStartRef.current = null;

                if (!interviewCompleteRef.current && !processingAnswerRef.current) {
                    updateVoiceStatus("Connection restored. Resuming...");
                    startRecordingSession();
                }
            } catch (err) {
                console.error("Resume connection call failed:", err);
                setIsOffline(false);
                isPausedDueToOfflineRef.current = false;
            }
        };

        window.addEventListener("offline", handleOffline);
        window.addEventListener("online", handleOnline);

        return () => {
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("online", handleOnline);
            if (disconnectTimerRef.current) {
                clearInterval(disconnectTimerRef.current);
            }
        };
    }, [interviewId]);

    // --------------------------------------------------
    // WEBSOCKET SETUP
    // --------------------------------------------------
    useEffect(() => {
        const token = localStorage.getItem("access_token") || localStorage.getItem("token");
        if (!interviewId || !token) return;

        const socket = new WebSocket(`${WS_URL}/ws/interview/${interviewId}?token=${token}`);
        wsRef.current = socket;

        socket.onopen = () => {
            setIsWsConnected(true);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "evaluating") {
                    setIsProcessingAnswer(true);
                    updateVoiceStatus("Evaluating answer via AI...");
                } else if (data.type === "interview_step") {
                    handleBackendResponse(data);
                } else if (data.type === "error") {
                    console.error("[WS Server Error]", data.message);
                    handleSubmissionFailure(new Error(data.message));
                }
            } catch (err) {
                console.error("[WS Parse Error]", err);
            }
        };

        socket.onerror = () => setIsWsConnected(false);
        socket.onclose = () => setIsWsConnected(false);

        return () => {
            if (socket) socket.close();
            wsRef.current = null;
        };
    }, [interviewId]);

    useEffect(() => {
        loadInterview();
        return () => {
            cleanupEverything();
        };
    }, [interviewId]);

    async function loadInterview() {
        try {
            const response = await fetch(`${API_URL}/interviews/current/${interviewId}`, {
                method: "GET",
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error(`Unable to load interview: ${response.status}`);
            }

            const data = await response.json();
            const prompt = data.current_prompt || data.current_question || "";
            const loadedQuestionNumber = data.question_number ?? 0;
            const loadedStepType = data.step_type || "intro";

            setCurrentPrompt(prompt);
            setQuestionNumber(loadedQuestionNumber);
            setStepType(loadedStepType);
            setRoleTitle(data.role || "");

            currentPromptRef.current = prompt;
            questionNumberRef.current = loadedQuestionNumber;
            stepTypeRef.current = loadedStepType;

            setRemark("");
            setHasSubmissionError(false);
            resetQuestionTimer();

            if (data.interview_active && prompt) {
                setInterviewStarted(true);
                setTimeout(() => {
                    if (!interviewCompleteRef.current) {
                        speakPrompt(prompt);
                    }
                }, 150);
            } else if (!data.interview_active) {
                finishInterview();
            }
        } catch (error) {
            console.error("[Interview Load Error]", error);
            updateVoiceStatus("Unable to load interview session.");
        }
    }

    function handleBackendResponse(data) {
        if (data.interview_complete || data.completed) {
            setRemark(data.remark || "");
            processingAnswerRef.current = false;
            setIsProcessingAnswer(false);
            setHasSubmissionError(false);
            finishInterview();
            return;
        }

        const nextPrompt = data.next_prompt || data.next_question || data.current_prompt || "";
        const nextQuestion = data.question_number ?? 0;
        const nextStep = data.next_step_type || data.step_type || "question";
        const nextRemark = data.remark || data.next_remark || "";

        if (!nextPrompt) {
            handleSubmissionFailure(new Error("Backend returned an empty prompt."));
            return;
        }

        setCurrentPrompt(nextPrompt);
        setQuestionNumber(nextQuestion);
        setStepType(nextStep);
        setRemark(nextRemark);

        currentPromptRef.current = nextPrompt;
        questionNumberRef.current = nextQuestion;
        stepTypeRef.current = nextStep;

        processingAnswerRef.current = false;
        setIsProcessingAnswer(false);
        setHasSubmissionError(false);
        resetQuestionTimer();

        const speechToSpeak = nextRemark ? `${nextRemark}. ${nextPrompt}` : nextPrompt;
        speakPrompt(speechToSpeak, data.audio_base64);
    }

    function handleSubmissionFailure(error) {
        console.error("[Submission Error]", error);
        processingAnswerRef.current = false;
        setIsProcessingAnswer(false);
        setHasSubmissionError(true);

        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        updateVoiceStatus("Evaluation failed. Click 'Retry Answer Submission' below.");
    }

    function clearTimer(ref) {
        if (ref.current) {
            clearTimeout(ref.current);
            ref.current = null;
        }
    }

    function clearIntervalTimer(ref) {
        if (ref.current) {
            clearInterval(ref.current);
            ref.current = null;
        }
    }

    function clearTtsFallbackTimer() {
        if (ttsFallbackTimerRef.current) {
            clearTimeout(ttsFallbackTimerRef.current);
            ttsFallbackTimerRef.current = null;
        }
    }

    function stopVAD() {
        isVADRunningRef.current = false;
        voiceSessionIdRef.current += 1;

        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        clearTimer(initialSilenceTimerRef);
        clearIntervalTimer(initialCountdownRef);

        silenceStartedAtRef.current = null;
        lastInitialSecRef.current = null;
        lastPauseSecRef.current = null;

        setInitialSecondsLeft(null);
        setPauseSecondsLeft(null);

        speechFramesRef.current = 0;
        silenceFramesRef.current = 0;
    }

    function stopRecorderAndMic() {
        if (recorderRef.current) {
            try {
                if (recorderRef.current.state !== "inactive") {
                    recorderRef.current.stop();
                }
            } catch (e) {}
            recorderRef.current = null;
        }

        if (microphoneStreamRef.current) {
            microphoneStreamRef.current.getTracks().forEach((track) => track.stop());
            microphoneStreamRef.current = null;
        }

        if (audioContextRef.current) {
            try {
                if (audioContextRef.current.state !== "closed") {
                    audioContextRef.current.close();
                }
            } catch (e) {}
            audioContextRef.current = null;
        }

        microphoneSourceRef.current = null;
        analyserRef.current = null;
        analyserDataRef.current = null;
        setIsListening(false);
    }

    function stopLiveRecognition() {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.onresult = null;
                recognitionRef.current.onerror = null;
                recognitionRef.current.onend = null;
                recognitionRef.current.stop();
            } catch (e) {}
            recognitionRef.current = null;
        }
    }

    function stopBrowserTTS() {
        if (activeAudioElementRef.current) {
            try {
                activeAudioElementRef.current.pause();
                activeAudioElementRef.current.currentTime = 0;
            } catch (e) {}
            activeAudioElementRef.current = null;
        }
        try {
            if ("speechSynthesis" in window) {
                window.speechSynthesis.cancel();
            }
        } catch (e) {}
        activeUtteranceRef.current = null;
    }

    function cleanupEverything() {
        clearTtsFallbackTimer();
        stopVAD();
        stopLiveRecognition();
        stopRecorderAndMic();
        stopBrowserTTS();

        if (questionTimerRef.current) {
            clearInterval(questionTimerRef.current);
            questionTimerRef.current = null;
        }
        if (disconnectTimerRef.current) {
            clearInterval(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
        }

        ttsSessionIdRef.current += 1;
        processingAnswerRef.current = false;
        listeningStartInProgressRef.current = false;

        setIsInterviewerSpeaking(false);
        setIsListening(false);
    }

    function startListeningAfterTTS(ttsSessionId) {
        if (listeningStartInProgressRef.current) return;
        if (ttsSessionId !== ttsSessionIdRef.current) return;
        if (interviewCompleteRef.current || processingAnswerRef.current || isPausedDueToOfflineRef.current) return;

        listeningStartInProgressRef.current = true;
        clearTtsFallbackTimer();
        setIsInterviewerSpeaking(false);
        updateVoiceStatus("Starting microphone...");

        setTimeout(async () => {
            if (
                ttsSessionId !== ttsSessionIdRef.current ||
                interviewCompleteRef.current ||
                processingAnswerRef.current ||
                isPausedDueToOfflineRef.current
            ) {
                listeningStartInProgressRef.current = false;
                return;
            }

            try {
                await startRecordingSession();
            } finally {
                listeningStartInProgressRef.current = false;
            }
        }, 100);
    }

    function speakPrompt(text, audioBase64 = null) {
        if (!text || interviewCompleteRef.current || isPausedDueToOfflineRef.current) return;
        const cleanText = String(text).trim();
        if (!cleanText) return;

        clearTtsFallbackTimer();
        stopVAD();
        stopRecorderAndMic();
        stopLiveRecognition();
        stopBrowserTTS();

        const ttsSessionId = ++ttsSessionIdRef.current;
        listeningStartInProgressRef.current = false;
        setIsInterviewerSpeaking(true);
        setIsListening(false);
        updateVoiceStatus("Interviewer is speaking...");

        // If audio base64 is delivered via WebSocket, stream it with HTML5 Audio
        if (audioBase64) {
            try {
                const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
                activeAudioElementRef.current = audio;
                audio.onended = () => {
                    if (ttsSessionId === ttsSessionIdRef.current) {
                        setIsInterviewerSpeaking(false);
                        startListeningAfterTTS(ttsSessionId);
                    }
                };
                audio.onerror = () => {
                    speakViaBrowserSynthesis(cleanText, ttsSessionId);
                };
                audio.play();
                return;
            } catch (err) {
                console.warn("[Base64 Audio Playback Failed] Falling back to browser TTS", err);
            }
        }

        speakViaBrowserSynthesis(cleanText, ttsSessionId);
    }

    function speakViaBrowserSynthesis(cleanText, ttsSessionId) {
        if (!("speechSynthesis" in window)) {
            setIsInterviewerSpeaking(false);
            startListeningAfterTTS(ttsSessionId);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        activeUtteranceRef.current = utterance;
        utterance.lang = "en-US";
        utterance.rate = 1;

        let finished = false;
        const finishTTS = () => {
            if (finished) return;
            finished = true;
            if (ttsSessionId === ttsSessionIdRef.current && !interviewCompleteRef.current) {
                setIsInterviewerSpeaking(false);
                startListeningAfterTTS(ttsSessionId);
            }
        };

        utterance.onend = finishTTS;
        utterance.onerror = finishTTS;

        try {
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            finishTTS();
        }
    }

    function speakClosingMessage(text) {
        if (!text || !("speechSynthesis" in window)) {
            setIsInterviewerSpeaking(false);
            return;
        }
        clearTtsFallbackTimer();
        stopVAD();
        stopLiveRecognition();
        stopRecorderAndMic();
        stopBrowserTTS();

        setIsInterviewerSpeaking(true);
        setIsListening(false);
        updateVoiceStatus("Interview completed.");

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.onend = () => setIsInterviewerSpeaking(false);
        utterance.onerror = () => setIsInterviewerSpeaking(false);
        try {
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            setIsInterviewerSpeaking(false);
        }
    }

    function startLiveRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        stopLiveRecognition();
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event) => {
            let fullText = "";
            for (let i = 0; i < event.results.length; i++) {
                fullText += " " + event.results[i][0].transcript;
            }

            const cleanText = fullText.trim();
            liveTranscriptRef.current = cleanText;

            if (cleanText.length > 0 && !hasStartedSpeakingRef.current) {
                hasStartedSpeakingRef.current = true;
                answerHasSpeechRef.current = true;

                clearTimer(initialSilenceTimerRef);
                clearIntervalTimer(initialCountdownRef);
                lastInitialSecRef.current = null;
                setInitialSecondsLeft(null);
                updateVoiceStatus("Listening to your answer...");
            }
        };

        recognition.onend = () => {
            if (
                isVADRunningRef.current &&
                !processingAnswerRef.current &&
                recognitionRef.current === recognition &&
                !isPausedDueToOfflineRef.current
            ) {
                try {
                    recognition.start();
                } catch (e) {}
            }
        };

        try {
            recognition.start();
        } catch (e) {}
    }

    async function startRecordingSession() {
        if (processingAnswerRef.current || interviewCompleteRef.current || isPausedDueToOfflineRef.current) return;
        if (isVADRunningRef.current) return;

        setHasSubmissionError(false);
        const answerToken = ++answerTokenRef.current;

        stopVAD();
        stopRecorderAndMic();
        stopLiveRecognition();

        audioChunksRef.current = [];
        liveTranscriptRef.current = "";
        hasStartedSpeakingRef.current = false;
        answerHasSpeechRef.current = false;
        speechFramesRef.current = 0;
        silenceFramesRef.current = 0;
        silenceStartedAtRef.current = null;
        lastPauseSecRef.current = null;
        setPauseSecondsLeft(null);

        const sessionId = ++voiceSessionIdRef.current;
        const silenceLimitSeconds = questionNumberRef.current >= 7 ? 30 : 10;
        const silenceLimitMs = silenceLimitSeconds * 1000;
        const deadline = Date.now() + silenceLimitMs;

        lastInitialSecRef.current = silenceLimitSeconds;
        setInitialSecondsLeft(silenceLimitSeconds);

        clearIntervalTimer(initialCountdownRef);
        clearTimer(initialSilenceTimerRef);

        initialCountdownRef.current = setInterval(() => {
            if (
                sessionId !== voiceSessionIdRef.current ||
                answerToken !== answerTokenRef.current ||
                hasStartedSpeakingRef.current ||
                isPausedDueToOfflineRef.current
            ) {
                clearIntervalTimer(initialCountdownRef);
                return;
            }

            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            if (remaining !== lastInitialSecRef.current) {
                lastInitialSecRef.current = remaining;
                setInitialSecondsLeft(remaining);
            }
            if (remaining <= 0) {
                clearIntervalTimer(initialCountdownRef);
            }
        }, 250);

        initialSilenceTimerRef.current = setTimeout(() => {
            if (
                sessionId !== voiceSessionIdRef.current ||
                answerToken !== answerTokenRef.current ||
                hasStartedSpeakingRef.current ||
                processingAnswerRef.current ||
                isPausedDueToOfflineRef.current
            ) {
                return;
            }

            clearIntervalTimer(initialCountdownRef);
            clearTimer(initialSilenceTimerRef);
            lastInitialSecRef.current = null;
            setInitialSecondsLeft(null);

            processAndSubmitAnswer(true);
        }, silenceLimitMs);

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("getUserMedia is not supported by this browser.");
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                }
            });

            if (sessionId !== voiceSessionIdRef.current || answerToken !== answerTokenRef.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            microphoneStreamRef.current = stream;

            // Desktop Chrome/Edge/Firefox record WebM; iPhones/Safari record MP4. Use the first one this browser supports.
            const RECORDER_TYPES = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/mp4;codecs=mp4a.40.2",
                "audio/mp4",
                "audio/ogg;codecs=opus",
            ];
            const mimeType = RECORDER_TYPES.find(
                (t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t)
            ) || "";

            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            recorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            recorder.start(1000);

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContextClass();
            audioContextRef.current = audioContext;

            if (audioContext.state === "suspended") {
                await audioContext.resume();
            }

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.15;
            analyserDataRef.current = new Uint8Array(analyser.fftSize);
            analyserRef.current = analyser;

            const source = audioContext.createMediaStreamSource(stream);
            microphoneSourceRef.current = source;
            source.connect(analyser);

            isVADRunningRef.current = true;
            setIsListening(true);
            updateVoiceStatus("Listening for your answer...");
            answerStartedAtRef.current = Date.now();

            startLiveRecognition();
            lastVadSampleTimeRef.current = performance.now();

            monitorVoice(sessionId, answerToken);
        } catch (error) {
            console.error("[Microphone Error]", error);
            isVADRunningRef.current = false;
            clearTimer(initialSilenceTimerRef);
            clearIntervalTimer(initialCountdownRef);
            stopLiveRecognition();
            stopRecorderAndMic();
            setIsListening(false);
            updateVoiceStatus("Microphone permission required.");
        }
    }

    function monitorVoice(sessionId, answerToken) {
        if (
            !isVADRunningRef.current ||
            processingAnswerRef.current ||
            sessionId !== voiceSessionIdRef.current ||
            answerToken !== answerTokenRef.current ||
            isPausedDueToOfflineRef.current
        ) {
            return;
        }

        const now = performance.now();
        if (now - lastVadSampleTimeRef.current < 33) {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = requestAnimationFrame(() =>
                monitorVoice(sessionId, answerToken)
            );
            return;
        }

        lastVadSampleTimeRef.current = now;
        const analyser = analyserRef.current;
        const dataArray = analyserDataRef.current;
        if (!analyser || !dataArray) return;

        analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const val = (dataArray[i] - 128) / 128;
            sum += val * val;
        }

        const rms = Math.sqrt(sum / dataArray.length);
        const timestamp = Date.now();
        const elapsedSinceStart = timestamp - (answerStartedAtRef.current || timestamp);

        if (elapsedSinceStart < 400) {
            noiseFloorRef.current = Math.max(0.005, noiseFloorRef.current * 0.8 + rms * 0.2);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = requestAnimationFrame(() =>
                monitorVoice(sessionId, answerToken)
            );
            return;
        }

        const speechThreshold = Math.max(0.065, noiseFloorRef.current * 3.5);
        const silenceThreshold = Math.max(0.025, noiseFloorRef.current * 1.6);
        const isIntro = stepTypeRef.current === "intro" || questionNumberRef.current === 0;
        const requiredPauseMs = isIntro ? 2000 : 4000;

        if (rms > speechThreshold) {
            speechFramesRef.current += 1;
            silenceFramesRef.current = 0;

            if (!hasStartedSpeakingRef.current && speechFramesRef.current >= 8) {
                hasStartedSpeakingRef.current = true;
                answerHasSpeechRef.current = true;
                clearTimer(initialSilenceTimerRef);
                clearIntervalTimer(initialCountdownRef);
                lastInitialSecRef.current = null;
                setInitialSecondsLeft(null);
                updateVoiceStatus("Listening to your answer...");
            }

            if (silenceStartedAtRef.current !== null && speechFramesRef.current >= 4) {
                silenceStartedAtRef.current = null;
                lastPauseSecRef.current = null;
                setPauseSecondsLeft(null);
                updateVoiceStatus("Listening to your answer...");
            }
        } else if (rms < silenceThreshold) {
            silenceFramesRef.current += 1;
            speechFramesRef.current = 0;

            if (hasStartedSpeakingRef.current && !processingAnswerRef.current) {
                if (!silenceStartedAtRef.current) {
                    silenceStartedAtRef.current = timestamp;
                }

                const elapsed = timestamp - silenceStartedAtRef.current;
                const remainingSec = Math.max(0, Math.ceil((requiredPauseMs - elapsed) / 1000));

                if (remainingSec !== lastPauseSecRef.current) {
                    lastPauseSecRef.current = remainingSec;
                    setPauseSecondsLeft(remainingSec);
                    updateVoiceStatus(
                        isIntro
                            ? `Pause detected. Advancing to Question 1 in: ${remainingSec}s...`
                            : `Pause detected. Submitting in: ${remainingSec}s...`
                    );
                }

                if (elapsed >= requiredPauseMs) {
                    silenceStartedAtRef.current = null;
                    lastPauseSecRef.current = null;
                    setPauseSecondsLeft(null);
                    isVADRunningRef.current = false;
                    processAndSubmitAnswer(false);
                    return;
                }
            }
        }

        if (isVADRunningRef.current && !processingAnswerRef.current) {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = requestAnimationFrame(() =>
                monitorVoice(sessionId, answerToken)
            );
        }
    }

    async function processAndSubmitAnswer(isSilentFromStart = false, forcedDuration = null) {
        if (processingAnswerRef.current) return;

        processingAnswerRef.current = true;
        setIsProcessingAnswer(true);

        stopVAD();
        stopLiveRecognition();
        stopRecorderAndMic();
        setIsListening(false);
        updateVoiceStatus("Evaluating answer...");

        const answerDuration = forcedDuration !== null
            ? forcedDuration
            : answerStartedAtRef.current
            ? Math.max(0, Math.round((Date.now() - answerStartedAtRef.current) / 1000))
            : 0;

        if (isSilentFromStart || !answerHasSpeechRef.current) {
            await submitAnswerToBackend("[candidate remained silent]", answerDuration);
            return;
        }

        const liveTranscript = (liveTranscriptRef.current || "").trim();
        if (liveTranscript.length > 0) {
            await submitAnswerToBackend(liveTranscript, answerDuration);
            return;
        }

        const chunks = audioChunksRef.current;
        if (!chunks || chunks.length === 0) {
            await submitAnswerToBackend("[candidate remained silent]", answerDuration);
            return;
        }

        try {
            const recordedType = (chunks[0]?.type || "audio/webm").toLowerCase();
            const fileExt = recordedType.includes("mp4") ? "mp4"
                : recordedType.includes("ogg") ? "ogg"
                : recordedType.includes("wav") ? "wav"
                : "webm";
            const blob = new Blob(chunks, { type: recordedType });
            const formData = new FormData();
            formData.append("file", blob, `answer.${fileExt}`);

            // Retry: a transcription ERROR is not the same as the candidate being silent
            let res = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    res = await fetch(`${API_URL}/interviews/audio/transcribe`, {
                        method: "POST",
                        headers: getAuthHeaders(),
                        body: formData
                    });
                    if (res.ok) break;
                } catch (e) {
                    res = null;
                }
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            }

            if (res && res.ok) {
                const data = await res.json();
                const text = String(data.transcription || data.text || "").trim();
                await submitAnswerToBackend(text || "[candidate remained silent]", answerDuration);
            } else {
                await submitAnswerToBackend("[candidate remained silent]", answerDuration);
            }
        } catch (error) {
            console.error("[Audio Transcription Error]", error);
            await submitAnswerToBackend("[candidate remained silent]", answerDuration);
        }
    }

    async function submitAnswerToBackend(answerText, durationSeconds = 0) {
        lastSubmittedAnswerRef.current = answerText;
        lastSubmittedDurationRef.current = durationSeconds;

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
                JSON.stringify({
                    action: "submit_answer",
                    interview_id: interviewId,
                    answer: answerText,
                    duration_seconds: durationSeconds
                })
            );
            return;
        }

        try {
            const res = await fetch(`${API_URL}/interviews/respond`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeaders()
                },
                body: JSON.stringify({
                    interview_id: interviewId,
                    answer: answerText,
                    duration_seconds: durationSeconds
                })
            });

            if (!res.ok) {
                throw new Error(`Server responded with ${res.status}`);
            }

            const data = await res.json();
            handleBackendResponse(data);
        } catch (error) {
            handleSubmissionFailure(error);
        }
    }

    async function handleConfirmEndInterview() {
        setIsEndingInterview(true);
        try {
            const res = await fetch(`${API_URL}/interviews/end`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeaders()
                },
                body: JSON.stringify({
                    interview_id: interviewId,
                    reason: "Candidate confirmed End Interview early"
                })
            });

            await res.json();
            setShowEndModal(false);
            finishInterview();
        } catch (err) {
            console.error("Failed to end interview:", err);
            finishInterview();
        } finally {
            setIsEndingInterview(false);
        }
    }

    function handleRetryAnswer() {
        if (processingAnswerRef.current) return;
        setHasSubmissionError(false);
        setIsProcessingAnswer(true);
        updateVoiceStatus("Retrying evaluation...");

        submitAnswerToBackend(
            lastSubmittedAnswerRef.current || "[candidate remained silent]",
            lastSubmittedDurationRef.current || 0
        );
    }

    function finishInterview() {
        cleanupEverything();
        sessionStorage.removeItem("active_interview_id");

        setInterviewComplete(true);
        interviewCompleteRef.current = true;
        setIsListening(false);
        updateVoiceStatus("Interview completed.");

        const closingText = "Thank you for your time today. That completes our interview.";
        speakClosingMessage(closingText);
    }

    function manualStart() {
        if (interviewCompleteRef.current) return;
        setInterviewStarted(true);
        setHasSubmissionError(false);
        resetQuestionTimer();
        speakPrompt(currentPromptRef.current);
    }

    const getHeaderBadgeText = () => {
        if (interviewComplete) return "Completed";
        if (stepType === "intro" || questionNumber === 0) return "Introduction";
        if (stepType === "follow_up") return `Question ${questionNumber} / 7 • Follow-up`;
        if (questionNumber >= 1 && questionNumber <= 5) return `Technical • ${questionNumber} / 7`;
        if (questionNumber === 6) return "Resume • 6 / 7";
        if (questionNumber === 7) return "Scenario • 7 / 7";
        return `Question ${questionNumber} / 7`;
    };

    const getPromptCategoryLabel = () => {
        if (stepType === "intro" || questionNumber === 0) return "Candidate Introduction";
        if (stepType === "follow_up") return "Adaptive Follow-up Question";
        if (questionNumber >= 1 && questionNumber <= 5) return `Technical Skill Question (${questionNumber} of 5)`;
        if (questionNumber === 6) return "Resume & Practical Experience Verification";
        if (questionNumber === 7) return "Situational & Emergency Scenario (Final Question)";
        return "Interview Question";
    };

    const getCategoryBadgeClass = () => {
        if (stepType === "follow_up") return "text-purple-400 border-purple-500/30 bg-purple-500/10";
        if (questionNumber === 6) return "text-sky-400 border-sky-500/30 bg-sky-500/10";
        if (questionNumber === 7) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
        return "text-indigo-400 border-indigo-500/30 bg-indigo-500/10";
    };

    const formatTimer = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? "0" : ""}${s}`;
    };

    return (
        <div className="min-h-screen w-full bg-[#070913] text-slate-100 font-sans selection:bg-purple-500 selection:text-white p-4 md:p-8 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none"></div>
            <div className="absolute bottom-10 right-10 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[130px] pointer-events-none"></div>

            {isOffline && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
                    <div className="bg-[#111320] border border-amber-500/50 rounded-3xl p-8 max-w-md w-full text-center space-y-5 shadow-2xl">
                        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto animate-pulse">
                            <WifiOff className="w-8 h-8" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-xl font-bold text-white tracking-wide">
                                Connection Lost
                            </h2>
                            <p className="text-xs text-slate-300 leading-relaxed">
                                All interview timers, recording, and voice have been frozen. Attempting to reconnect...
                            </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                            <p className="text-[11px] text-amber-300 uppercase font-bold tracking-wider">
                                Reconnecting Window
                            </p>
                            <p className="text-3xl font-extrabold text-amber-400 mt-1">
                                {formatTimer(disconnectSecondsLeft)}
                            </p>
                        </div>
                        <p className="text-[11px] text-slate-400">
                            If the connection is restored within 2 minutes, you will resume from the exact same point.
                        </p>
                    </div>
                </div>
            )}

            {showEndModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#111320] border border-purple-500/40 rounded-3xl p-6 md:p-8 max-w-md w-full space-y-6 shadow-2xl">
                        <div className="flex items-center space-x-3 text-red-400">
                            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">End Interview?</h3>
                                <p className="text-xs text-slate-400">Confirmation Required</p>
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-2 leading-relaxed">
                            <p>Are you sure you want to end your interview now?</p>
                            <p className="text-amber-400 font-medium">
                                • Questions completed so far will keep their evaluated marks.
                                <br />
                                • All unattempted questions will receive 0 marks.
                                <br />
                                • Your final score will be calculated out of 80.
                            </p>
                        </div>

                        <label className="flex items-start space-x-3 text-xs text-slate-300 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={confirmEndChecked}
                                onChange={(e) => setConfirmEndChecked(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500 cursor-pointer"
                            />
                            <span>
                                Will you want to end the interview? Yes or no. (Check to confirm Yes)
                            </span>
                        </label>

                        <div className="grid grid-cols-2 gap-3 pt-2">
                            <button
                                type="button"
                                disabled={!confirmEndChecked || isEndingInterview}
                                onClick={handleConfirmEndInterview}
                                className="py-2.5 px-4 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center space-x-1.5"
                            >
                                {isEndingInterview ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        <span>Ending...</span>
                                    </>
                                ) : (
                                    <span>Yes, End Interview</span>
                                )}
                            </button>

                            <button
                                type="button"
                                disabled={isEndingInterview}
                                onClick={() => {
                                    setShowEndModal(false);
                                    setConfirmEndChecked(false);
                                }}
                                className="py-2.5 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
                            >
                                No, Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header: role, question progress, timer, connection */}
            <nav className="w-full max-w-5xl flex flex-wrap items-center justify-between gap-3 mb-6 relative z-10">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
                        <User className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xs font-bold uppercase tracking-wider text-slate-400 leading-tight">
                            Mock Interview
                        </h1>
                        <span className="text-sm font-extrabold text-white tracking-wide">
                            {roleTitle ? `${roleTitle} Session` : "AI Interview Session"}
                        </span>
                    </div>
                </div>

                <div className="hidden md:flex flex-col items-center space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">{getHeaderBadgeText()}</span>
                    <div className="flex space-x-1.5">
                        {Array.from({ length: 7 }, (_, i) => (
                            <div
                                key={i}
                                className={`h-1.5 w-9 rounded-full ${
                                    i < questionNumber - 1
                                        ? "bg-purple-500"
                                        : i === questionNumber - 1
                                        ? "bg-purple-300"
                                        : "bg-slate-800"
                                }`}
                            ></div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    {interviewStarted && !interviewComplete && (
                        <div
                            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-full text-sm font-bold border transition ${
                                questionTimeLeft <= 60
                                    ? "bg-red-500/10 text-red-400 border-red-500/40 animate-pulse"
                                    : "bg-slate-900/80 text-purple-300 border-purple-500/30"
                            }`}
                        >
                            <Clock className="w-4 h-4" />
                            <span>{formatTimer(questionTimeLeft)}</span>
                        </div>
                    )}

                    <div
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border ${
                            isWsConnected
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : "bg-slate-900/80 text-slate-400 border-slate-800"
                        }`}
                    >
                        <Radio className={`w-3 h-3 ${isWsConnected ? "animate-pulse text-emerald-400" : "text-slate-500"}`} />
                        <span>{isWsConnected ? "Live Socket" : "REST"}</span>
                    </div>

                    <div className="md:hidden px-3 py-1.5 rounded-full bg-slate-900/80 border border-purple-500/30 text-xs font-semibold text-purple-300">
                        {getHeaderBadgeText()}
                    </div>
                </div>
            </nav>

            <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6 relative z-10">
                {/* Interviewer: Aria the robot */}
                <div className="bg-[#111320]/90 rounded-3xl border border-purple-500/30 p-6 flex flex-col items-center space-y-3 shadow-[0_0_50px_rgba(147,51,234,0.12)]">
                    <div className="relative w-44 h-44 md:w-52 md:h-52 flex items-center justify-center">
                        {isInterviewerSpeaking && (
                            <>
                                <div className="absolute inset-2 rounded-full border-2 border-purple-400/50 animate-ping"></div>
                                <div className="absolute inset-0 rounded-full border border-purple-400/30"></div>
                            </>
                        )}
                        {isListening && !isInterviewerSpeaking && (
                            <div className="absolute inset-1 rounded-full border-2 border-emerald-400/50 shadow-[0_0_30px_rgba(16,185,129,0.25)]"></div>
                        )}
                        <svg viewBox="0 0 170 170" className="w-36 h-36 md:w-44 md:h-44" role="img" aria-label="Aria, your AI interviewer">
                            <defs>
                                <linearGradient id="ariaGrad" x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0" stopColor="#6366f1" />
                                    <stop offset="1" stopColor="#a855f7" />
                                </linearGradient>
                            </defs>
                            <line x1="85" y1="18" x2="85" y2="34" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" />
                            <circle cx="85" cy="14" r="7" fill="#67e8f9" />
                            <rect x="12" y="68" width="14" height="38" rx="7" fill="#4f46e5" />
                            <rect x="144" y="68" width="14" height="38" rx="7" fill="#4f46e5" />
                            <rect x="24" y="34" width="122" height="104" rx="34" fill="url(#ariaGrad)" />
                            <rect x="38" y="52" width="94" height="58" rx="22" fill="#0b0f24" />
                            <circle cx="64" cy="78" r="8" fill="#67e8f9" />
                            <circle cx="106" cy="78" r="8" fill="#67e8f9" />
                            <path d="M68 96 Q85 108 102 96" fill="none" stroke="#67e8f9" strokeWidth="4" strokeLinecap="round" />
                            <path d="M52 142 Q85 158 118 142 L118 152 Q85 168 52 152 Z" fill="#4f46e5" />
                        </svg>
                    </div>

                    <div className="text-center">
                        <div className="text-xl font-bold text-white">Aria</div>
                        <div className="text-xs text-slate-400">Your AI interviewer</div>
                    </div>

                    <div
                        className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-semibold ${
                            isInterviewerSpeaking
                                ? "bg-purple-500/15 text-purple-200"
                                : isListening
                                ? "bg-emerald-500/15 text-emerald-300"
                                : isProcessingAnswer
                                ? "bg-indigo-500/15 text-indigo-200"
                                : "bg-slate-900 text-slate-400"
                        }`}
                    >
                        {isInterviewerSpeaking ? (
                            <Volume2 className="w-4 h-4 animate-pulse" />
                        ) : isListening ? (
                            <Mic className="w-4 h-4" />
                        ) : isProcessingAnswer ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <MicOff className="w-4 h-4" />
                        )}
                        <span>
                            {isInterviewerSpeaking
                                ? "Speaking..."
                                : isListening
                                ? "Listening..."
                                : isProcessingAnswer
                                ? "Evaluating..."
                                : "Ready"}
                        </span>
                    </div>

                    <p className="text-xs text-slate-400 text-center leading-relaxed">
                        Listen to the whole question. The microphone starts by itself when Aria finishes.
                    </p>
                </div>

                {/* Question and answer status */}
                <div className="space-y-6">
                    <div className="bg-[#111320]/90 rounded-3xl border border-purple-500/30 p-6 md:p-8 shadow-[0_0_50px_rgba(147,51,234,0.12)] min-h-[200px] flex flex-col justify-center">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border ${getCategoryBadgeClass()}`}>
                                {getPromptCategoryLabel()}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">
                                {stepType === "intro" ? "Introductory Phase" : `Stage ${questionNumber} of 7`}
                            </span>
                        </div>

                        <div className="text-xl md:text-2xl font-semibold text-slate-50 leading-relaxed pt-1">
                            {currentPrompt || "Preparing question..."}
                        </div>

                        {remark && !interviewComplete && (
                            <div className="mt-4 pt-3 border-t border-slate-800/80 text-emerald-400 text-sm font-semibold flex items-center space-x-2">
                                <Sparkles className="w-4 h-4" />
                                <span>{remark}</span>
                            </div>
                        )}
                    </div>

                    <div className="bg-[#111320]/90 rounded-3xl border border-purple-500/20 p-5 md:p-6 flex flex-col items-center justify-center space-y-3 min-h-[150px]">
                        <div
                            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${
                                isInterviewerSpeaking
                                    ? "bg-purple-500/10 border-2 border-purple-500/50"
                                    : isListening
                                    ? "bg-emerald-500/15 border-2 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)] animate-pulse"
                                    : "bg-slate-900 border border-slate-800"
                            }`}
                            aria-hidden="true"
                        >
                            {isInterviewerSpeaking ? (
                                <Volume2 className="w-7 h-7 text-purple-300" />
                            ) : isListening ? (
                                <Mic className="w-7 h-7 text-emerald-300" />
                            ) : (
                                <MicOff className="w-7 h-7 text-slate-500" />
                            )}
                        </div>

                        <div className="text-sm font-medium text-slate-300 text-center min-h-[22px]">
                            {voiceStatusText}
                        </div>

                        {initialSecondsLeft !== null && isListening && (
                            <div className="px-3.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
                                Time to begin speaking: {initialSecondsLeft}s {questionNumber >= 7 ? "(30s Silence Limit)" : "(10s Silence Limit)"}
                            </div>
                        )}

                        {pauseSecondsLeft !== null && isListening && (
                            <div className="px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                                {stepType === "intro" || questionNumber === 0
                                    ? `Pause detected. Advancing to Question 1 in: ${pauseSecondsLeft}s`
                                    : `Pause detected. Submitting answer in: ${pauseSecondsLeft}s`}
                            </div>
                        )}

                        {isProcessingAnswer && (
                            <div className="flex items-center space-x-2 text-xs font-semibold text-purple-400 pt-1">
                                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                                <span>Evaluating response with AI...</span>
                            </div>
                        )}

                        {hasSubmissionError && !isProcessingAnswer && (
                            <button
                                onClick={handleRetryAnswer}
                                className="mt-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold rounded-xl flex items-center space-x-2 transition cursor-pointer"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Retry Answer Submission</span>
                            </button>
                        )}
                    </div>

                    {!interviewStarted && !interviewComplete && (
                        <button
                            onClick={manualStart}
                            className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white font-bold rounded-2xl shadow-[0_0_30px_rgba(147,51,234,0.4)] transition flex items-center justify-center space-x-2 text-sm cursor-pointer"
                        >
                            <span>Start Interview</span>
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    )}

                    {interviewComplete && (
                        <div className="bg-[#111320]/90 rounded-3xl border border-emerald-500/30 p-6 text-center space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto shadow-lg shadow-emerald-500/10">
                                <CheckCircle className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-white">
                                    Interview Session Complete
                                </h3>
                                <p className="text-xs text-slate-400 mt-1">
                                    Your answers have been recorded and evaluated. You can view your full performance report in My Interviews.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate("/my-interviews")}
                                className="w-full py-3.5 px-6 bg-slate-950/70 hover:bg-purple-500/10 border border-purple-500/30 hover:border-purple-500/60 text-slate-200 hover:text-white font-semibold rounded-2xl transition flex items-center justify-center space-x-2 text-sm cursor-pointer"
                            >
                                <FileText className="w-4 h-4 text-purple-400" />
                                <span>View My Interviews & Results</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom bar: the big End Interview button */}
            {interviewStarted && !interviewComplete && (
                <div className="w-full max-w-5xl mt-6 pt-5 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 relative z-10">
                    <p className="text-xs text-slate-400 leading-relaxed">
                        Answered questions keep their marks. If you close this tab, you have 2 minutes to come back.
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowEndModal(true)}
                        className="h-14 px-8 rounded-2xl border-2 border-red-500 bg-red-500/10 hover:bg-red-500/20 text-red-200 text-base font-bold transition flex items-center justify-center space-x-3 cursor-pointer w-full sm:w-auto"
                    >
                        <XOctagon className="w-5 h-5" />
                        <span>End Interview</span>
                    </button>
                </div>
            )}
        </div>
    );
}