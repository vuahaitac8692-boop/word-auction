/* ==========================================
   WORD AUCTION - APPLICATION
   Supabase JavaScript v2
   ========================================== */

(() => {
    "use strict";

    // ==========================================
    // 1. SUPABASE CONFIGURATION
    // ==========================================

    const config = window.WORD_AUCTION_CONFIG;

    if (
        !config ||
        !config.SUPABASE_URL ||
        !config.SUPABASE_ANON_KEY ||
        config.SUPABASE_URL.includes("DAN_") ||
        config.SUPABASE_ANON_KEY.includes("DAN_")
    ) {
        alert("Bạn chưa điền cấu hình Supabase trong file config.js.");
        return;
    }

    if (!window.supabase?.createClient) {
        alert("Không tải được thư viện Supabase.");
        return;
    }

    const supabaseClient = window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY
    );

    // ==========================================
    // 2. APPLICATION STATE
    // ==========================================

    const state = {
        user: null,
        profile: null,
        room: null,
        players: [],
        question: null,

        selectedAnswer: null,
        hasBet: false,

        isHost: false,
        isSpectator: false,

        timerInterval: null,
        questionInterval: null,
        nextQuestionTimeout: null,

        subscriptions: [],

        questionNumber: 1,
        questionDeadline: null,

        isSubmitting: false,
        isCreatingQuestion: false,
        isFinishing: false
    };

    const $ = id => document.getElementById(id);

    const formatPoints = value =>
        Number(value || 0).toLocaleString("vi-VN");

    // ==========================================
    // 3. GENERAL HELPERS
    // ==========================================

    function showNotification(message, type = "info") {
        const element = $("notification");

        if (!element) {
            console.log(message);
            return;
        }

        element.textContent = message;
        element.classList.remove("hidden");

        element.style.borderColor =
            type === "error" ? "#ff5878" :
            type === "success" ? "#35dfa0" :
            "#20d9ff";

        clearTimeout(showNotification.timeout);

        showNotification.timeout = setTimeout(() => {
            element.classList.add("hidden");
        }, 3500);
    }

    function setButtonLoading(
        buttonId,
        loading,
        loadingText = "ĐANG XỬ LÝ..."
    ) {
        const button = $(buttonId);

        if (!button) return;

        if (loading) {
            if (!button.dataset.oldText) {
                button.dataset.oldText = button.textContent;
            }

            button.textContent = loadingText;
            button.disabled = true;
        } else {
            button.textContent =
                button.dataset.oldText || button.textContent;

            delete button.dataset.oldText;
            button.disabled = false;
        }
    }

    function showScreen(screenId) {
        document.querySelectorAll(".screen").forEach(screen => {
            screen.classList.remove("active");
        });

        const target = $(screenId);

        if (target) {
            target.classList.add("active");
        }

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }

    function handleError(error, prefix = "Có lỗi xảy ra") {
        console.error(prefix, error);

        const message =
            error?.message ||
            error?.details ||
            String(error);

        showNotification(prefix + ": " + message, "error");
    }

    function getRpcData(result) {
        return result?.data ?? null;
    }

    function getRoomCode(room) {
        return String(
            room?.room_code ||
            room?.code ||
            ""
        ).trim().toUpperCase();
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(String(value || ""));
    }

    function setText(id, value) {
        const element = $(id);

        if (element) {
            element.textContent = value ?? "";
        }
    }

    function setHtml(id, value) {
        const element = $(id);

        if (element) {
            element.innerHTML = value;
        }
    }

    function clearQuestionTimers() {
        clearInterval(state.questionInterval);
        clearTimeout(state.nextQuestionTimeout);

        state.questionInterval = null;
        state.nextQuestionTimeout = null;
    }

    function clearGameTimer() {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }

    // ==========================================
    // 4. AUTHENTICATION
    // ==========================================

    async function initializeAuth() {
        try {
            let { data, error } =
                await supabaseClient.auth.getSession();

            if (error) throw error;

            if (!data.session) {
                const result =
                    await supabaseClient.auth.signInAnonymously();

                if (result.error) {
                    throw result.error;
                }

                data = {
                    session: result.data.session
                };
            }

            state.user = data.session.user;

            await loadProfile();

            setText("connectionStatus", "● Đã kết nối");

            if ($("connectionStatus")) {
                $("connectionStatus").style.color = "#35dfa0";
            }

        } catch (error) {
            setText("connectionStatus", "● Lỗi kết nối");

            handleError(
                error,
                "Không thể đăng nhập Supabase"
            );

            throw error;
        }
    }

    async function loadProfile() {
        if (!state.user) return;

        const { data, error } = await supabaseClient
            .from("profiles")
            .select("*")
            .eq("user_id", state.user.id)
            .single();

        if (error) throw error;

        state.profile = data;

        renderProfile();
    }

    function renderProfile() {
        if (!state.profile) return;

        const nickname =
            state.profile.nickname || "Người chơi";

        const points =
            state.profile.points ?? 1000;

        setText("headerNickname", nickname);
        setText("profileNickname", nickname);
        setText("profilePoints", formatPoints(points));

        if (state.profile.is_admin) {
            addAdminButton();
        }
    }

    function addAdminButton() {
        if ($("openAdminBtn")) return;

        const homeScreen = $("homeScreen");

        if (!homeScreen) return;

        const button = document.createElement("button");

        button.id = "openAdminBtn";
        button.className = "btn btn-outline";
        button.textContent = "QUẢN TRỊ TỪ VỰNG";
        button.style.margin = "15px 0";

        button.addEventListener("click", () => {
            showScreen("adminScreen");
        });

        homeScreen.appendChild(button);
    }

    // ==========================================
    // 5. PROFILE AND PLAYER DATA
    // ==========================================

    async function refreshProfile() {
        await loadProfile();

        if (!state.room) return;

        const player = state.players.find(
            item => item.user_id === state.user.id
        );

        if (!player) return;

        state.isSpectator =
            !!player.is_spectator ||
            Number(player.points) <= 0;

        setText(
            "gameMyPoints",
            formatPoints(player.points)
        );

        setText(
            "availableBetPoints",
            formatPoints(player.points)
        );

        setText(
            "gamePlayerStatus",
            state.isSpectator ? "Khán giả" : "Đang chơi"
        );

        if (state.isSpectator) {
            disableBetting(
                "Bạn đã hết điểm và chuyển sang chế độ khán giả."
            );
        }
    }

    // ==========================================
    // 6. CREATE ROOM
    // ==========================================

    async function createRoom() {
        const durationElement = $("roomDuration");

        const duration = Number(
            durationElement?.value || 10
        );

        if (!Number.isInteger(duration) || duration <= 0) {
            showNotification(
                "Thời lượng phòng không hợp lệ.",
                "error"
            );
            return;
        }

        setButtonLoading(
            "createRoomBtn",
            true,
            "ĐANG TẠO PHÒNG..."
        );

        try {
            const { data, error } =
                await supabaseClient.rpc(
                    "create_auction_room",
                    {
                        p_duration: duration
                    }
                );

            if (error) throw error;

            const result = getRpcData({ data });

            if (!result) {
                throw new Error(
                    "Supabase không trả về dữ liệu phòng."
                );
            }

            const roomId =
                result.room_id || result.id;

            const roomCode =
                result.room_code || result.code;

            if (roomId) {
                await enterRoomByIdOrCode(roomId);
            } else if (roomCode) {
                await enterRoomByIdOrCode(roomCode);
            } else if (typeof result === "string") {
                await enterRoomByIdOrCode(result);
            } else {
                await findMyWaitingRoom();
            }

            showNotification(
                "Tạo phòng thành công!",
                "success"
            );

        } catch (error) {
            handleError(error, "Không thể tạo phòng");
        } finally {
            setButtonLoading("createRoomBtn", false);
        }
    }

    async function findMyWaitingRoom() {
        const { data, error } = await supabaseClient
            .from("auction_rooms")
            .select("*")
            .eq("host_id", state.user.id)
            .eq("status", "waiting")
            .order("created_at", {
                ascending: false
            })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            throw new Error(
                "Không tìm thấy phòng vừa tạo."
            );
        }

        await openRoom(data);
    }

    // ==========================================
    // 7. JOIN ROOM
    // ==========================================

    async function joinRoom() {
        const input = $("joinRoomCode");

        const code = String(
            input?.value || ""
        ).trim().toUpperCase();

        if (!code) {
            showNotification(
                "Vui lòng nhập mã phòng.",
                "error"
            );
            return;
        }

        setButtonLoading(
            "joinRoomBtn",
            true,
            "ĐANG THAM GIA..."
        );

        try {
            const { data, error } =
                await supabaseClient.rpc(
                    "join_auction_room",
                    {
                        p_room_code: code
                    }
                );

            if (error) throw error;

            const result = getRpcData({ data });

            const roomId =
                result?.room_id || result?.id;

            await enterRoomByIdOrCode(
                roomId || code
            );

            showNotification(
                "Tham gia phòng thành công!",
                "success"
            );

        } catch (error) {
            handleError(
                error,
                "Không thể tham gia phòng"
            );
        } finally {
            setButtonLoading("joinRoomBtn", false);
        }
    }

    async function enterRoomByIdOrCode(value) {
        const text = String(value || "").trim();

        if (!text) {
            throw new Error(
                "Không nhận được mã hoặc ID phòng."
            );
        }

        let query = supabaseClient
            .from("auction_rooms")
            .select("*");

        if (isUuid(text)) {
            query = query.eq("id", text);
        } else {
            query = query.eq(
                "room_code",
                text.toUpperCase()
            );
        }

        const { data, error } = await query.single();

        if (error) throw error;

        if (!data) {
            throw new Error("Không tìm thấy phòng.");
        }

        await openRoom(data);
    }

    // ==========================================
    // 8. OPEN ROOM
    // ==========================================

    async function openRoom(room) {
        if (!room) {
            throw new Error("Dữ liệu phòng không hợp lệ.");
        }

        clearQuestionTimers();

        state.room = room;
        state.isHost =
            room.host_id === state.user.id;

        await refreshPlayers();

        if (room.status === "active") {
            showScreen("gameScreen");

            await loadCurrentQuestion();

            startTimer();

        } else if (room.status === "finished") {
            await showFinalResults();

        } else {
            showScreen("waitingScreen");

            renderWaitingRoom();
        }

        subscribeRoom();
    }

    async function refreshPlayers() {
        if (!state.room) return;

        const { data, error } = await supabaseClient
            .from("auction_players")
            .select("*")
            .eq("room_id", state.room.id)
            .order("joined_at", {
                ascending: true
            });

        if (error) throw error;

        state.players = data || [];

        // Lấy nickname từ profiles để hiển thị danh sách.
        try {
            const userIds = state.players
                .map(player => player.user_id)
                .filter(Boolean);

            if (userIds.length > 0) {
                const { data: profiles } =
                    await supabaseClient
                        .from("profiles")
                        .select("user_id,nickname")
                        .in("user_id", userIds);

                if (profiles) {
                    const profileMap = new Map(
                        profiles.map(profile => [
                            profile.user_id,
                            profile.nickname
                        ])
                    );

                    state.players = state.players.map(player => ({
                        ...player,
                        nickname:
                            player.nickname ||
                            profileMap.get(player.user_id) ||
                            null
                    }));
                }
            }
        } catch (error) {
            console.warn(
                "Không lấy được nickname người chơi:",
                error
            );
        }

        renderWaitingPlayers();
        renderLeaderboard();
    }

    function renderWaitingRoom() {
        setText(
            "waitingRoomCode",
            getRoomCode(state.room) || "CHƯA CÓ MÃ PHÒNG"
        );

        setText(
            "waitingDuration",
            (state.room.duration_minutes || 0) + " phút"
        );

        setText("waitingStatus", "Đang chờ");

        const startButton = $("startGameBtn");

        if (startButton) {
            startButton.style.display =
                state.isHost ? "inline-block" : "none";
        }

        setText(
            "waitingHelpText",
            state.isHost
                ? "Bạn là chủ phòng. Có thể bắt đầu trận đấu."
                : "Đang chờ chủ phòng bắt đầu trận đấu."
        );
    }

    function renderWaitingPlayers() {
        setText(
            "waitingPlayerCount",
            state.players.length + " người"
        );

        const list = $("waitingPlayerList");

        if (!list) return;

        list.innerHTML = "";

        state.players.forEach((player, index) => {
            const profileName =
                player.nickname ||
                player.user_id?.slice(0, 8) ||
                "Người chơi";

            const item = document.createElement("div");
            item.className = "player-item";

            const left = document.createElement("span");

            left.textContent =
                (index + 1) + ". " + profileName;

            const right = document.createElement("strong");

            right.textContent =
                player.user_id === state.room.host_id
                    ? "CHỦ PHÒNG"
                    : "NGƯỜI CHƠI";

            item.append(left, right);
            list.appendChild(item);
        });
    }

    // ==========================================
    // 9. REALTIME SUBSCRIPTIONS
    // ==========================================

    function unsubscribeRoom() {
        state.subscriptions.forEach(channel => {
            supabaseClient.removeChannel(channel);
        });

        state.subscriptions = [];
    }

    function subscribeRoom() {
        unsubscribeRoom();

        if (!state.room) return;

        const roomId = state.room.id;

        const roomChannel = supabaseClient
            .channel("room-" + roomId)

            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "auction_rooms",
                    filter: "id=eq." + roomId
                },
                async payload => {
                    try {
                        if (!payload.new) return;

                        state.room = payload.new;

                        if (payload.new.status === "active") {
                            showScreen("gameScreen");

                            await loadCurrentQuestion();

                            startTimer();
                        }

                        if (payload.new.status === "finished") {
                            clearQuestionTimers();

                            await showFinalResults();
                        }

                    } catch (error) {
                        handleError(
                            error,
                            "Lỗi đồng bộ thông tin phòng"
                        );
                    }
                }
            )

            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "auction_players",
                    filter: "room_id=eq." + roomId
                },
                async () => {
                    try {
                        await refreshPlayers();
                        await refreshProfile();
                    } catch (error) {
                        console.error(
                            "Lỗi cập nhật danh sách người chơi:",
                            error
                        );
                    }
                }
            )

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "auction_questions",
                    filter: "room_id=eq." + roomId
                },
                async payload => {
                    try {
                        if (!payload.new) return;

                        // Tránh xử lý lại câu hỏi đang hiển thị.
                        if (
                            state.question?.id === payload.new.id
                        ) {
                            return;
                        }

                        state.question = payload.new;

                        state.questionNumber =
                            payload.new.sequence_no ||
                            state.questionNumber + 1;

                        state.selectedAnswer = null;
                        state.hasBet = false;

                        renderQuestion();

                        await checkMyBet();

                        startQuestionTimer();

                    } catch (error) {
                        handleError(
                            error,
                            "Lỗi đồng bộ câu hỏi"
                        );
                    }
                }
            )

            .subscribe(status => {
                console.log(
                    "Realtime status:",
                    status
                );
            });

        state.subscriptions.push(roomChannel);
    }

    // ==========================================
    // 10. START GAME
    // ==========================================

    async function startGame() {
        if (!state.isHost || !state.room) return;

        setButtonLoading(
            "startGameBtn",
            true,
            "ĐANG BẮT ĐẦU..."
        );

        try {
            const { error } =
                await supabaseClient.rpc(
                    "start_auction_room",
                    {
                        p_room_id: state.room.id
                    }
                );

            if (error) throw error;

            const { error: questionError } =
                await supabaseClient.rpc(
                    "create_auction_question",
                    {
                        p_room_id: state.room.id
                    }
                );

            if (questionError) {
                throw questionError;
            }

            showScreen("gameScreen");

            await refreshPlayers();

            await loadCurrentQuestion();

            startTimer();

            showNotification(
                "Trận đấu đã bắt đầu!",
                "success"
            );

        } catch (error) {
            handleError(
                error,
                "Không thể bắt đầu trận đấu"
            );
        } finally {
            setButtonLoading("startGameBtn", false);
        }
    }

    // ==========================================
    // 11. QUESTIONS
    // ==========================================

    async function loadCurrentQuestion() {
        if (!state.room) return;

        const { data, error } = await supabaseClient
            .from("auction_questions")
            .select("*")
            .eq("room_id", state.room.id)
            .order("sequence_no", {
                ascending: false
            })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (!data) return;

        const isNewQuestion =
            state.question?.id !== data.id;

        state.question = data;

        state.questionNumber =
            data.sequence_no || 1;

        if (isNewQuestion) {
            state.selectedAnswer = null;
            state.hasBet = false;
        }

        renderQuestion();

        await checkMyBet();

        startQuestionTimer();
    }

    function renderQuestion() {
        if (!state.question || !state.room) return;

        const question = state.question;

        setText(
            "gameRoomCode",
            getRoomCode(state.room) || "CHƯA CÓ MÃ PHÒNG"
        );

        setText(
            "questionNumber",
            "CÂU HỎI #" +
            (question.sequence_no || state.questionNumber)
        );

        setText(
            "questionWord",
            question.tu_vung ||
            question.word ||
            question.english_word ||
            "---"
        );

        setText(
            "questionPhonetic",
            question.phien_am ||
            question.phonetic ||
            ""
        );

        setText(
            "questionType",
            question.tu_loai ||
            question.word_type ||
            ""
        );

        const options = question.options || [];

        const answerContainer = $("answerOptions");

        if (!answerContainer) return;

        answerContainer.innerHTML = "";

        options.forEach((option, index) => {
            const button = document.createElement("button");

            button.className = "answer-option";
            button.dataset.index = index;

            const letter = document.createElement("span");

            letter.className = "option-letter";
            letter.textContent =
                String.fromCharCode(65 + index);

            const text = document.createElement("span");

            text.className = "option-text";

            text.textContent =
                typeof option === "string"
                    ? option
                    : (
                        option.nghiaTiengViet ||
                        option.text ||
                        ""
                    );

            button.append(letter, text);

            button.addEventListener("click", () => {
                selectAnswer(index);
            });

            answerContainer.appendChild(button);
        });

        if ($("betAmount")) {
            $("betAmount").value = "";
        }

        setText(
            "betMessage",
            "Hãy chọn đáp án và nhập điểm cược."
        );

        enableBetting();

        updateBetAvailability();

        if (state.hasBet) {
            disableBetting(
                "Bạn đã đặt điểm cho câu hỏi này."
            );
        }
    }

    function selectAnswer(index) {
        if (
            state.hasBet ||
            state.isSpectator ||
            state.isSubmitting
        ) {
            return;
        }

        state.selectedAnswer = index;

        document.querySelectorAll(".answer-option")
            .forEach(button => {
                button.classList.toggle(
                    "selected",
                    Number(button.dataset.index) === index
                );
            });
    }

    async function checkMyBet() {
        if (!state.question || !state.user) return;

        const { data, error } = await supabaseClient
            .from("auction_bets")
            .select("id")
            .eq("question_id", state.question.id)
            .eq("user_id", state.user.id)
            .maybeSingle();

        if (error) {
            console.warn(
                "Không kiểm tra được lượt cược:",
                error
            );
            return;
        }

        if (data) {
            state.hasBet = true;

            disableBetting(
                "Bạn đã đặt điểm cho câu hỏi này."
            );
        }
    }

    // ==========================================
    // 12. QUESTION TIMER - 10 SECONDS
    // ==========================================

    function startQuestionTimer() {
        clearQuestionTimers();

        if (!state.question || !state.room) return;

        const questionId = state.question.id;

        const createdAt = state.question.created_at
            ? new Date(state.question.created_at).getTime()
            : Date.now();

        // Mỗi câu hỏi có thời gian trả lời 10 giây.
        state.questionDeadline = createdAt + 10000;

        const update = async () => {
            if (
                !state.question ||
                state.question.id !== questionId
            ) {
                clearQuestionTimers();
                return;
            }

            const remaining = Math.max(
                0,
                Math.ceil(
                    (state.questionDeadline - Date.now()) / 1000
                )
            );

            // Hiển thị thời gian trong phần thông báo cược.
            if (!state.hasBet) {
                setText(
                    "betMessage",
                    "Thời gian còn lại: " + remaining + " giây"
                );
            }

            if (remaining <= 0) {
                clearInterval(state.questionInterval);
                state.questionInterval = null;

                // Hết giờ, người chưa trả lời sẽ được ghi nhận timeout.
                if (!state.hasBet && !state.isSpectator) {
                    await submitTimeout(questionId);
                }

                // Chỉ chủ phòng được quyền tạo câu tiếp theo.
                if (state.isHost) {
                    state.nextQuestionTimeout = setTimeout(
                        async () => {
                            if (
                                state.question?.id === questionId &&
                                state.room?.status === "active"
                            ) {
                                await nextQuestion();
                            }
                        },
                        1000
                    );
                }
            }
        };

        update();

        state.questionInterval = setInterval(
            update,
            250
        );
    }

    async function submitTimeout(questionId) {
        if (
            !state.question ||
            state.question.id !== questionId ||
            state.hasBet ||
            state.isSpectator
        ) {
            return;
        }

        // Đánh dấu trước để tránh gửi nhiều lần.
        state.hasBet = true;

        disableBetting(
            "Hết thời gian trả lời. Đang ghi nhận lượt chơi..."
        );

        try {
            const { error } = await supabaseClient.rpc(
                "place_auction_bet",
                {
                    p_question_id: questionId,
                    p_answer_index: null,
                    p_bet_points: 0
                }
            );

            if (error) throw error;

            setText(
                "betMessage",
                "Bạn đã hết thời gian trả lời."
            );

            await refreshPlayers();

        } catch (error) {
            console.error(
                "Không thể ghi nhận lượt timeout:",
                error
            );

            // Không tự gửi lặp lại vì có thể RPC đã xử lý.
            setText(
                "betMessage",
                "Đã hết thời gian trả lời."
            );
        }
    }

    // ==========================================
    // 13. BETTING
    // ==========================================

    function updateBetAvailability() {
        const player = state.players.find(
            item => item.user_id === state.user?.id
        );

        const points = Number(
            player?.points ??
            state.profile?.points ??
            1000
        );

        setText(
            "availableBetPoints",
            formatPoints(points)
        );

        document.querySelectorAll(".bet-shortcut")
            .forEach(button => {
                if (button.dataset.bet === "1000") {
                    button.textContent = "Tất cả";
                }
            });
    }

    function disableBetting(message) {
        document.querySelectorAll(".answer-option")
            .forEach(button => {
                button.disabled = true;
            });

        if ($("betAmount")) {
            $("betAmount").disabled = true;
        }

        if ($("submitBetBtn")) {
            $("submitBetBtn").disabled = true;
        }

        setText("betMessage", message);
    }

    function enableBetting() {
        if (state.isSpectator || state.hasBet) {
            disableBetting(
                state.isSpectator
                    ? "Bạn đang ở chế độ khán giả."
                    : "Bạn đã đặt điểm cho câu hỏi này."
            );
            return;
        }

        document.querySelectorAll(".answer-option")
            .forEach(button => {
                button.disabled = false;
            });

        if ($("betAmount")) {
            $("betAmount").disabled = false;
        }

        if ($("submitBetBtn")) {
            $("submitBetBtn").disabled = false;
        }
    }

    async function submitBet() {
        if (
            !state.question ||
            !state.room ||
            state.isSubmitting
        ) {
            return;
        }

        if (state.hasBet) {
            showNotification(
                "Bạn đã đặt điểm cho câu hỏi này.",
                "error"
            );
            return;
        }

        if (state.selectedAnswer === null) {
            showNotification(
                "Bạn cần chọn một đáp án.",
                "error"
            );
            return;
        }

        const betPoints = Number(
            $("betAmount")?.value
        );

        if (
            !Number.isInteger(betPoints) ||
            betPoints <= 0
        ) {
            showNotification(
                "Điểm cược phải là số nguyên lớn hơn 0.",
                "error"
            );
            return;
        }

        const player = state.players.find(
            item => item.user_id === state.user.id
        );

        const currentPoints = Number(
            player?.points ??
            state.profile?.points ??
            1000
        );

        if (betPoints > currentPoints) {
            showNotification(
                "Điểm cược vượt quá số điểm hiện có.",
                "error"
            );
            return;
        }

        if (
            state.questionDeadline &&
            Date.now() >= state.questionDeadline
        ) {
            showNotification(
                "Đã hết thời gian trả lời.",
                "error"
            );
            return;
        }

        state.isSubmitting = true;

        setButtonLoading(
            "submitBetBtn",
            true,
            "ĐANG GỬI..."
        );

        try {
            const { data, error } =
                await supabaseClient.rpc(
                    "place_auction_bet",
                    {
                        p_question_id: state.question.id,
                        p_answer_index: state.selectedAnswer,
                        p_bet_points: betPoints
                    }
                );

            if (error) throw error;

            state.hasBet = true;

            disableBetting(
                "Đã gửi đáp án và điểm cược. Chờ kết quả."
            );

            const result = getRpcData({ data });

            if (result?.is_correct === true) {
                showNotification(
                    "Chính xác! Bạn được cộng điểm.",
                    "success"
                );

            } else if (result?.is_correct === false) {
                showNotification(
                    "Chưa chính xác. Bạn bị trừ điểm cược.",
                    "error"
                );

            } else {
                showNotification(
                    "Đã đặt điểm thành công!",
                    "success"
                );
            }

            await refreshPlayers();

            await refreshProfile();

        } catch (error) {
            handleError(
                error,
                "Không thể đặt điểm"
            );

        } finally {
            state.isSubmitting = false;

            if (!state.hasBet) {
                setButtonLoading(
                    "submitBetBtn",
                    false
                );
            }
        }
    }

    // ==========================================
    // 14. BET SHORTCUT BUTTONS
    // ==========================================

    document.querySelectorAll(".bet-shortcut")
        .forEach(button => {
            button.addEventListener("click", () => {
                if (
                    state.hasBet ||
                    state.isSpectator ||
                    !state.user
                ) {
                    return;
                }

                const player = state.players.find(
                    item => item.user_id === state.user.id
                );

                const points = Number(
                    player?.points ??
                    state.profile?.points ??
                    1000
                );

                const value = button.dataset.bet;

                if (!$("betAmount")) return;

                $("betAmount").value =
                    value === "1000"
                        ? points
                        : Math.min(Number(value), points);
            });
        });

    // ==========================================
    // 15. NEXT QUESTION
    // ==========================================

    async function nextQuestion() {
        if (!state.isHost) {
            return;
        }

        if (
            !state.room ||
            state.room.status !== "active" ||
            state.isCreatingQuestion
        ) {
            return;
        }

        state.isCreatingQuestion = true;

        clearQuestionTimers();

        setButtonLoading(
            "nextQuestionBtn",
            true,
            "ĐANG TẠO CÂU..."
        );

        try {
            const { error } =
                await supabaseClient.rpc(
                    "create_auction_question",
                    {
                        p_room_id: state.room.id
                    }
                );

            if (error) throw error;

            await loadCurrentQuestion();

            showNotification(
                "Đã tạo câu hỏi mới.",
                "success"
            );

        } catch (error) {
            handleError(
                error,
                "Không thể tạo câu hỏi mới"
            );

        } finally {
            state.isCreatingQuestion = false;

            setButtonLoading(
                "nextQuestionBtn",
                false
            );
        }
    }

    // ==========================================
    // 16. LEADERBOARD
    // ==========================================

    function renderLeaderboard() {
        const sorted = [...state.players].sort(
            (a, b) =>
                Number(b.points) - Number(a.points)
        );

        setText(
            "gamePlayerCount",
            sorted.length
        );

        const leaderboard = $("gameLeaderboard");

        if (leaderboard) {
            leaderboard.innerHTML = "";

            sorted.forEach((player, index) => {
                const item = document.createElement("div");

                item.className = "leaderboard-item";

                const left = document.createElement("span");

                const rank = document.createElement("span");

                rank.className = "rank";
                rank.textContent = index + 1;

                const name = document.createElement("span");

                name.textContent =
                    player.nickname ||
                    player.user_id?.slice(0, 8) ||
                    "Người chơi";

                left.append(rank, name);

                const score = document.createElement("strong");

                score.textContent =
                    formatPoints(player.points) + " điểm";

                item.append(left, score);

                leaderboard.appendChild(item);
            });
        }

        const me = state.players.find(
            player => player.user_id === state.user?.id
        );

        if (me) {
            setText(
                "gameMyPoints",
                formatPoints(me.points)
            );

            setText(
                "availableBetPoints",
                formatPoints(me.points)
            );
        }
    }

    // ==========================================
    // 17. GAME TIMER
    // ==========================================

    function startTimer() {
        clearGameTimer();

        if (!state.room?.ends_at) return;

        const update = () => {
            const remaining = Math.max(
                0,
                Math.floor(
                    (
                        new Date(state.room.ends_at).getTime() -
                        Date.now()
                    ) / 1000
                )
            );

            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;

            setText(
                "gameTimer",
                String(minutes).padStart(2, "0") +
                ":" +
                String(seconds).padStart(2, "0")
            );

            if (remaining <= 0) {
                clearGameTimer();

                if (state.isHost) {
                    finishGame();
                }
            }
        };

        update();

        state.timerInterval = setInterval(
            update,
            1000
        );
    }

    // ==========================================
    // 18. FINISH GAME
    // ==========================================

    async function finishGame() {
        if (
            !state.isHost ||
            !state.room ||
            state.isFinishing
        ) {
            return;
        }

        state.isFinishing = true;

        clearQuestionTimers();
        clearGameTimer();

        try {
            const { error } =
                await supabaseClient.rpc(
                    "finish_auction_room",
                    {
                        p_room_id: state.room.id
                    }
                );

            if (error) throw error;

            await showFinalResults();

        } catch (error) {
            handleError(
                error,
                "Không thể kết thúc trận đấu"
            );

        } finally {
            state.isFinishing = false;
        }
    }

    async function showFinalResults() {
        clearGameTimer();
        clearQuestionTimers();

        await refreshPlayers();

        const sorted = [...state.players].sort(
            (a, b) =>
                Number(b.points) - Number(a.points)
        );

        const leaderboard = $("finalLeaderboard");

        if (leaderboard) {
            leaderboard.innerHTML = "";

            sorted.forEach((player, index) => {
                const item = document.createElement("div");

                item.className = "leaderboard-item";

                const left = document.createElement("span");

                left.textContent =
                    (index + 1) +
                    ". " +
                    (
                        player.nickname ||
                        player.user_id?.slice(0, 8) ||
                        "Người chơi"
                    );

                const score = document.createElement("strong");

                score.textContent =
                    formatPoints(player.points) + " điểm";

                item.append(left, score);

                leaderboard.appendChild(item);
            });
        }

        showScreen("resultScreen");
    }

    // ==========================================
    // 19. LEAVE ROOM
    // ==========================================

    async function leaveRoom() {
        if (!state.room) {
            showScreen("homeScreen");
            return;
        }

        try {
            const { error } =
                await supabaseClient.rpc(
                    "leave_auction_room",
                    {
                        p_room_id: state.room.id
                    }
                );

            if (error) throw error;

            clearGameTimer();
            clearQuestionTimers();

            unsubscribeRoom();

            state.room = null;
            state.players = [];
            state.question = null;

            state.selectedAnswer = null;
            state.hasBet = false;

            state.isSpectator = false;
            state.isHost = false;

            state.questionNumber = 1;

            await refreshProfile();

            showScreen("homeScreen");

            showNotification(
                "Đã rời phòng.",
                "success"
            );

        } catch (error) {
            handleError(
                error,
                "Không thể rời phòng"
            );
        }
    }

    // ==========================================
    // 20. ADMIN - IMPORT VOCABULARY
    // ==========================================

    async function importVocabulary() {
        if (!state.profile?.is_admin) {
            showNotification(
                "Bạn không có quyền quản trị.",
                "error"
            );
            return;
        }

        let vocabulary;

        try {
            vocabulary = JSON.parse(
                $("vocabularyJson")?.value || ""
            );

        } catch (error) {
            showNotification(
                "Dữ liệu JSON không hợp lệ.",
                "error"
            );
            return;
        }

        if (
            !Array.isArray(vocabulary) ||
            vocabulary.length === 0
        ) {
            showNotification(
                "Dữ liệu phải là một mảng JSON có từ vựng.",
                "error"
            );
            return;
        }

        setButtonLoading(
            "importVocabularyBtn",
            true,
            "ĐANG NHẬP..."
        );

        try {
            const { data, error } =
                await supabaseClient.rpc(
                    "import_vocabulary",
                    {
                        p_data: vocabulary
                    }
                );

            if (error) throw error;

            setText(
                "importMessage",
                "Đã gửi dữ liệu nhập từ vựng thành công."
            );

            showNotification(
                "Nhập từ vựng thành công!",
                "success"
            );

            console.log(
                "Import result:",
                data
            );

        } catch (error) {
            handleError(
                error,
                "Không thể nhập từ vựng"
            );

            setText(
                "importMessage",
                error.message
            );

        } finally {
            setButtonLoading(
                "importVocabularyBtn",
                false
            );
        }
    }

    async function loadVocabularyFile(file) {
        if (!file) return;

        try {
            const text = await file.text();

            JSON.parse(text);

            if ($("vocabularyJson")) {
                $("vocabularyJson").value = text;
            }

            showNotification(
                "Đã đọc file JSON.",
                "success"
            );

        } catch (error) {
            showNotification(
                "File JSON không hợp lệ.",
                "error"
            );
        }
    }

    // ==========================================
    // 21. EVENT LISTENERS
    // ==========================================

    function on(id, eventName, callback) {
        const element = $(id);

        if (element) {
            element.addEventListener(
                eventName,
                callback
            );
        } else {
            console.warn(
                "Không tìm thấy phần tử HTML:",
                id
            );
        }
    }

    on("createRoomBtn", "click", createRoom);

    on("joinRoomBtn", "click", joinRoom);

    on("startGameBtn", "click", startGame);

    on("leaveWaitingBtn", "click", leaveRoom);

    on("submitBetBtn", "click", submitBet);

    on("nextQuestionBtn", "click", nextQuestion);

    on("leaveGameBtn", "click", leaveRoom);

    on("backHomeBtn", "click", async () => {
        clearGameTimer();
        clearQuestionTimers();

        state.room = null;
        state.players = [];
        state.question = null;

        state.hasBet = false;
        state.isHost = false;
        state.isSpectator = false;

        unsubscribeRoom();

        showScreen("homeScreen");

        try {
            await refreshProfile();
        } catch (error) {
            handleError(
                error,
                "Không thể tải lại thông tin người chơi"
            );
        }
    });

    on("adminBackBtn", "click", () => {
        showScreen("homeScreen");
    });

    on(
        "importVocabularyBtn",
        "click",
        importVocabulary
    );

    on("vocabularyFile", "change", event => {
        loadVocabularyFile(
            event.target.files?.[0]
        );
    });

    // ==========================================
    // 22. INITIALIZE APPLICATION
    // ==========================================

    async function initializeApp() {
        try {
            await initializeAuth();

            console.log(
                "Word Auction initialized successfully."
            );

        } catch (error) {
            console.error(
                "Word Auction initialization failed:",
                error
            );
        }
    }

    initializeApp();

})();