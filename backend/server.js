const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

const PORT = 8000;

app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage()
});

/* ====================================================== */
/* SESSIONS                                               */
/* ====================================================== */

const sessions = {};

/* ====================================================== */
/* QUESTIONS                                              */
/* ====================================================== */

const MAIN_QUESTIONS = {
    1: "What is the difference between local state and global state in an application, and when would you use each?",

    2: "What is the difference between a process and a thread, and why is multithreading useful?",

    3: "Suppose you have a database handling millions of requests. How would you design the schema and optimize queries for high throughput?",

    4: "What is the difference between REST APIs and WebSockets, and when would you choose WebSockets?",

    5: "Suppose your application suddenly becomes slow in production. How would you identify the performance bottleneck or a possible memory leak?",

    6: "Tell me about an important project or technical experience you have worked on. What was your contribution and what technical challenges did you face?",

    7: "Imagine your application suddenly receives ten times more traffic than expected in production. What steps would you take to keep the system stable?"
};

const INTRO_PROMPT =
    "Hello, welcome to your GLITCHX technical interview. Please introduce yourself.";

/* ====================================================== */
/* TEST SCORES                                            */
/* ====================================================== */

const MAIN_TEST_SCORES = {
    1: 9,
    2: 4,
    3: 7,
    4: 10,
    5: 3,
    6: 7,
    7: 8
};

const FOLLOWUP_TEST_SCORES = {
    1: 9,
    2: 4,
    4: 10,
    5: 3,
    6: 7
};

/* ====================================================== */
/* REMARKS                                                */
/* ====================================================== */

function getRemark(score) {
    if (score === 10) {
        return "Outstanding";
    }

    if (score === 9) {
        return "Excellent";
    }

    if (score >= 5) {
        return "Good";
    }

    return "";
}

/* ====================================================== */
/* SILENCE                                                */
/* ====================================================== */

function isSilentAnswer(answer) {
    const value = String(answer || "")
        .trim()
        .toLowerCase();

    return (
        value === "" ||
        value === "[candidate remained silent]" ||
        value === "[silent]" ||
        value === "[no answer]"
    );
}

/* ====================================================== */
/* MAIN SCORE                                             */
/* ====================================================== */

function getMainScore(
    questionNumber,
    silent
) {
    if (silent) {
        return 0;
    }

    return MAIN_TEST_SCORES[
        questionNumber
    ] ?? 0;
}

/* ====================================================== */
/* FOLLOW-UP SCORE                                        */
/* ====================================================== */

function getFollowUpScore(
    questionNumber,
    silent
) {
    if (silent) {
        return 0;
    }

    return FOLLOWUP_TEST_SCORES[
        questionNumber
    ] ?? 0;
}

/* ====================================================== */
/* FOLLOW-UP RULE                                         */
/* ====================================================== */

function getFollowUpType(
    questionNumber,
    score
) {
    /*
     * Q7 NEVER gets follow-up.
     */

    if (questionNumber === 7) {
        return null;
    }

    /*
     * Q6 ALWAYS gets exactly one follow-up.
     */

    if (questionNumber === 6) {
        return "experience";
    }

    /*
     * Score 0-4:
     * foundational follow-up.
     */

    if (score <= 4) {
        return "foundational";
    }

    /*
     * Score 5-8:
     * no follow-up.
     */

    if (score <= 8) {
        return null;
    }

    /*
     * Score 9-10:
     * advanced follow-up.
     */

    return "advanced";
}

/* ====================================================== */
/* FOLLOW-UP QUESTIONS                                    */
/* ====================================================== */

function generateFollowUp(
    questionNumber,
    type
) {
    if (questionNumber === 1) {
        if (type === "advanced") {
            return "How would you design a scalable state management architecture for a large application with many independent modules?";
        }

        return "Can you give a simple example of when you would use local state instead of global state?";
    }

    if (questionNumber === 2) {
        if (type === "advanced") {
            return "How would you handle synchronization and race conditions between multiple threads accessing shared resources?";
        }

        return "Can you explain in simple terms why multiple threads can be useful inside a process?";
    }

    if (questionNumber === 4) {
        if (type === "advanced") {
            return "How would you design a WebSocket architecture that can support millions of concurrent connections?";
        }

        return "Can you give an example where WebSockets would be more appropriate than a normal REST request?";
    }

    if (questionNumber === 5) {
        if (type === "advanced") {
            return "How would you design an observability system to automatically detect performance regressions and memory leaks?";
        }

        return "What basic tools or metrics would you check first when investigating a slow application?";
    }

    if (questionNumber === 6) {
        return "What was the most difficult technical problem in that project, and how did you solve it?";
    }

    return null;
}

/* ====================================================== */
/* CREATE SESSION                                         */
/* ====================================================== */

function createSession(
    interviewId,
    userId
) {
    sessions[interviewId] = {
        interview_id: interviewId,

        user_id: userId,

        question_number: 0,

        step_type: "intro",

        current_prompt:
            INTRO_PROMPT,

        interview_active: true,

        completed: false,

        history: [],

        scores: {
            main: {},
            follow_up: {}
        },

        final_score: null,

        final_report: null
    };

    return sessions[interviewId];
}

/* ====================================================== */
/* GET SESSION                                            */
/* ====================================================== */

function getSession(
    interviewId,
    userId
) {
    if (!sessions[interviewId]) {
        return createSession(
            interviewId,
            userId
        );
    }

    return sessions[
        interviewId
    ];
}

/* ====================================================== */
/* HISTORY                                                */
/* ====================================================== */

function addHistory(
    session,
    questionNumber,
    stepType,
    answer,
    score,
    remark
) {
    session.history.push({
        question_number:
            questionNumber,

        step_type:
            stepType,

        answer,

        score,

        remark:
            remark || "",

        timestamp:
            new Date().toISOString()
    });
}

/* ====================================================== */
/* FINAL SCORE                                            */
/* ====================================================== */

function finishInterview(
    session
) {
    let totalScore = 0;

    for (
        let q = 1;
        q <= 7;
        q++
    ) {
        const mainScore =
            session.scores.main[q] ??
            0;

        const followUpScore =
            session.scores.follow_up[q];

        let questionScore;

        /*
         * If a follow-up exists:
         *
         * Main = 70%
         * Follow-up = 30%
         */

        if (
            typeof followUpScore ===
            "number"
        ) {
            questionScore =
                mainScore * 0.7 +
                followUpScore * 0.3;
        }

        /*
         * If there is no follow-up:
         *
         * Main = 100%
         */

        else {
            questionScore =
                mainScore;
        }

        totalScore +=
            questionScore;
    }

    const finalScore =
        totalScore / 7;

    session.completed = true;

    session.interview_active =
        false;

    session.final_score =
        Number(
            finalScore.toFixed(2)
        );

    session.final_report = {
        final_score:
            session.final_score,

        maximum_score: 10,

        scores:
            session.scores,

        history:
            session.history
    };

    return session.final_report;
}

/* ====================================================== */
/* MOCK AUTH                                              */
/* ====================================================== */

app.use(
    (req, res, next) => {
        const token =
            req.headers.authorization;

        req.user = {
            id: token
                ? "user_authenticated"
                : "user_default",

            name: "Candidate"
        };

        next();
    }
);

/* ====================================================== */
/* HEALTH                                                */
/* ====================================================== */

app.get(
    "/",
    (req, res) => {
        res.json({
            status: "online",

            service:
                "GLITCHX Mock Backend",

            version: "1.0.0"
        });
    }
);

/* ====================================================== */
/* CURRENT INTERVIEW                                      */
/* ====================================================== */

app.get(
    "/interviews/current/:interviewId",
    (req, res) => {
        const {
            interviewId
        } = req.params;

        const session =
            getSession(
                interviewId,
                req.user.id
            );

        res.json({
            interview_id:
                session.interview_id,

            current_prompt:
                session.current_prompt,

            question_number:
                session.question_number,

            step_type:
                session.step_type,

            interview_active:
                session.interview_active
        });
    }
);

/* ====================================================== */
/* TRANSCRIPTION                                          */
/* ====================================================== */

app.post(
    "/interviews/audio/transcribe",
    upload.single("file"),
    (req, res) => {
        const isSilent =
            String(
                req.body.is_silent
            ).toLowerCase() ===
            "true";

        /*
         * Silence must never become
         * a fake answer.
         */

        if (isSilent) {
            return res.json({
                transcription: ""
            });
        }

        if (!req.file) {
            return res.status(400).json({
                error:
                    "Audio file is required."
            });
        }

        /*
         * MOCK TRANSCRIPTION ONLY.
         *
         * Production will use your
         * separate Whisper audio service.
         */

        return res.json({
            transcription:
                "I would first analyze the problem, identify the main bottleneck, and then choose an appropriate technical solution based on the requirements and trade-offs."
        });
    }
);

/* ====================================================== */
/* RESPOND                                               */
/* ====================================================== */

app.post(
    "/interviews/:interviewId/respond",
    (req, res) => {
        const {
            interviewId
        } = req.params;

        const {
            answer,
            duration_seconds
        } = req.body;

        if (!interviewId) {
            return res.status(400).json({
                error:
                    "interviewId is required."
            });
        }

        const session =
            getSession(
                interviewId,
                req.user.id
            );

        /* ================================================= */
        /* ALREADY COMPLETED                                */
        /* ================================================= */

        if (session.completed) {
            return res.json({
                completed: true,

                current_prompt:
                    "Thank you for your time today. That completes our technical interview.",

                question_number: 7,

                step_type:
                    "completed",

                remark: "",

                final_score:
                    session.final_score,

                report:
                    session.final_report
            });
        }

        const candidateAnswer =
            String(
                answer || ""
            ).trim();

        const silent =
            isSilentAnswer(
                candidateAnswer
            );

        /* ================================================= */
        /* INTRO                                             */
        /* ================================================= */

        if (
            session.step_type ===
            "intro"
        ) {
            /*
             * INTRO IS NEVER SCORED.
             */

            addHistory(
                session,
                0,
                "intro",
                candidateAnswer,
                null,
                ""
            );

            session.question_number =
                1;

            session.step_type =
                "question";

            session.current_prompt =
                MAIN_QUESTIONS[1];

            return res.json({
                completed: false,

                current_prompt:
                    session.current_prompt,

                question_number:
                    1,

                step_type:
                    "question",

                remark: "",

                duration_seconds:
                    duration_seconds || 0
            });
        }

        /* ================================================= */
        /* FOLLOW-UP                                         */
        /* ================================================= */

        if (
            session.step_type ===
            "follow_up"
        ) {
            const q =
                session.question_number;

            /*
             * Silent follow-up = 0.
             */

            const followUpScore =
                getFollowUpScore(
                    q,
                    silent
                );

            session.scores.follow_up[
                q
            ] = followUpScore;

            const followUpRemark =
                getRemark(
                    followUpScore
                );

            addHistory(
                session,
                q,
                "follow_up",
                candidateAnswer,
                followUpScore,
                followUpRemark
            );

            /*
             * Follow-up can only happen once.
             *
             * After follow-up:
             * move to next main question.
             */

            const nextQuestion =
                q + 1;

            /*
             * This is a safety check.
             */

            if (
                nextQuestion > 7
            ) {
                const report =
                    finishInterview(
                        session
                    );

                return res.json({
                    completed: true,

                    current_prompt:
                        "Thank you for your time today. That completes our technical interview.",

                    question_number:
                        7,

                    step_type:
                        "completed",

                    remark:
                        followUpScore >= 5
                            ? followUpRemark
                            : "",

                    final_score:
                        report.final_score,

                    report
                });
            }

            session.question_number =
                nextQuestion;

            session.step_type =
                "question";

            session.current_prompt =
                MAIN_QUESTIONS[
                    nextQuestion
                ];

            return res.json({
                completed: false,

                current_prompt:
                    session.current_prompt,

                question_number:
                    nextQuestion,

                step_type:
                    "question",

                remark:
                    followUpScore >= 5
                        ? followUpRemark
                        : "",

                duration_seconds:
                    duration_seconds || 0
            });
        }

        /* ================================================= */
        /* MAIN QUESTION                                     */
        /* ================================================= */

        if (
            session.step_type ===
            "question"
        ) {
            const q =
                session.question_number;

            /*
             * Silent main answer = 0.
             */

            const mainScore =
                getMainScore(
                    q,
                    silent
                );

            session.scores.main[q] =
                mainScore;

            const mainRemark =
                getRemark(
                    mainScore
                );

            addHistory(
                session,
                q,
                "main",
                candidateAnswer,
                mainScore,
                mainRemark
            );

            /* ============================================= */
            /* Q7                                             */
            /* ============================================= */

            if (q === 7) {
                const report =
                    finishInterview(
                        session
                    );

                return res.json({
                    completed: true,

                    current_prompt:
                        "Thank you for your time today. That completes our technical interview.",

                    question_number:
                        7,

                    step_type:
                        "completed",

                    remark:
                        mainScore >= 5
                            ? mainRemark
                            : "",

                    final_score:
                        report.final_score,

                    report
                });
            }

            /* ============================================= */
            /* FOLLOW-UP DECISION                             */
            /* ============================================= */

            const followUpType =
                getFollowUpType(
                    q,
                    mainScore
                );

            /* ============================================= */
            /* NO FOLLOW-UP                                   */
            /* ============================================= */

            if (!followUpType) {
                const nextQuestion =
                    q + 1;

                session.question_number =
                    nextQuestion;

                session.step_type =
                    "question";

                session.current_prompt =
                    MAIN_QUESTIONS[
                        nextQuestion
                    ];

                return res.json({
                    completed: false,

                    current_prompt:
                        session.current_prompt,

                    question_number:
                        nextQuestion,

                    step_type:
                        "question",

                    remark:
                        mainScore >= 5
                            ? mainRemark
                            : "",

                    duration_seconds:
                        duration_seconds || 0
                });
            }

            /* ============================================= */
            /* FOLLOW-UP EXISTS                              */
            /* ============================================= */

            const followUpPrompt =
                generateFollowUp(
                    q,
                    followUpType
                );

            session.step_type =
                "follow_up";

            session.current_prompt =
                followUpPrompt;

            return res.json({
                completed: false,

                current_prompt:
                    session.current_prompt,

                question_number:
                    q,

                step_type:
                    "follow_up",

                remark:
                    mainScore >= 5
                        ? mainRemark
                        : "",

                duration_seconds:
                    duration_seconds || 0
            });
        }

        /* ================================================= */
        /* INVALID STATE                                    */
        /* ================================================= */

        return res.status(400).json({
            error:
                "Invalid interview state."
        });
    }
);

/* ====================================================== */
/* REPORT                                                 */
/* ====================================================== */

app.get(
    "/interviews/report/:interviewId",
    (req, res) => {
        const {
            interviewId
        } = req.params;

        const session =
            sessions[
                interviewId
            ];

        if (!session) {
            return res.status(404).json({
                error:
                    "Interview not found."
            });
        }

        if (!session.completed) {
            return res.json({
                completed: false,

                message:
                    "Interview is still in progress."
            });
        }

        return res.json({
            completed: true,

            final_score:
                session.final_score,

            report:
                session.final_report,

            history:
                session.history
        });
    }
);

/* ====================================================== */
/* HISTORY                                                */
/* ====================================================== */

app.get(
    "/interviews/history",
    (req, res) => {
        const history = [];

        for (
            const interviewId in sessions
        ) {
            const session =
                sessions[
                    interviewId
                ];

            history.push({
                interview_id:
                    interviewId,

                completed:
                    session.completed,

                final_score:
                    session.final_score ??
                    null
            });
        }

        res.json({
            interviews:
                history
        });
    }
);

/* ====================================================== */
/* RESET                                                  */
/* ====================================================== */

app.post(
    "/debug/reset/:interviewId",
    (req, res) => {
        const {
            interviewId
        } = req.params;

        delete sessions[
            interviewId
        ];

        return res.json({
            success: true,

            message:
                "Interview session reset."
        });
    }
);

/* ====================================================== */
/* DEBUG SESSION                                          */
/* ====================================================== */

app.get(
    "/debug/session/:interviewId",
    (req, res) => {
        const {
            interviewId
        } = req.params;

        const session =
            sessions[
                interviewId
            ];

        if (!session) {
            return res.status(404).json({
                error:
                    "Session not found."
            });
        }

        return res.json(
            session
        );
    }
);

/* ====================================================== */
/* START SERVER                                           */
/* ====================================================== */

app.listen(
    PORT,
    () => {
        console.log(
            `🚀 GLITCHX Mock Server running on http://127.0.0.1:${PORT}`
        );
    }
);