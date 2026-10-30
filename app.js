/* ==========================================
   WORD AUCTION - APPLICATION
   Supabase JavaScript v2
   ========================================== */

(() => {
    "use strict";

    // ======================================
    // 1. SUPABASE CONFIGURATION
    // ======================================

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

    const { createClient } = window.supabase;

    const supabaseClient = createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY
    );

    // ======================================
    // 2. APPLICATION STATE
    // ======================================

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
        questionTimerInterval: null,
        questionAdvanceTimeout: null,
        questionDeadline: null,

        isSubmittingBet: false,
        isAdvancingQuestion: false,

        subscriptions: [],
        questionNumber: 1
    };

    const $ = id => document.getElementById(id);

    const formatPoints = value =>
        Number(value || 0).toLocaleString("vi-VN");

    // ======================================
    // 3. BET AMOUNT MEMORY
    // ======================================

    function getSavedBetAmount() {
        const saved = Number(
            localStorage.getItem("wordAuctionBetAmount")
        );

        return Number.isInteger(saved) && saved > 0
            ? saved
            : 100;
    }

    function saveBetAmount(value) {
        const amount = Number(value);

        if (Number.isInteger(amount) && amount > 0) {
            localStorage.setItem(
                "wordAuctionBetAmount",
                String(amount)
            );
        }
    }

    // ======================================
    // 4. GENERAL HELPERS
    // ======================================

    function showNotification(message, type = "info") {
        const element = $("notification");
        if (!element) return;

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
            button.dataset.oldText = button.textContent;
            button.textContent = loadingText;
            button.disabled = true;
        } else {
            button.textContent =
                button.dataset.oldText || button.textContent;

            button.disabled = false;
        }
    }

    function showScreen(screenId) {
        document.querySelectorAll(".screen").forEach(screen => {
            screen.classList.remove("active");
        });

        const target = $(screenId);
        if (target) target.classList.add("active");

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

    // ======================================
    // 5. AUTHENTICATION
    // ======================================

    async function initializeAuth() {
        try {
            let { data, error } =
                await supabaseClient.auth.getSession();

            if (error) throw error;

            if (!data.session) {
                const result =
                    await supabaseClient.auth.signInAnonymously();

                if (result.error) throw result.error;

                data = {
                    session: result.data.session
                };
            }

            state.user = data.session.user;

            await loadProfile();

            $("connectionStatus").textContent = "● Đã kết nối";
            $("connectionStatus").style.color = "#35dfa0";

        } catch (error) {
            $("connectionStatus").textContent = "● Lỗi kết nối";
            handleError(error, "Không thể đăng nhập Supabase");
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

        const points = state.profile.points ?? 1000;

        $("headerNickname").textContent = nickname;
        $("profileNickname").textContent = nickname;
        $("profilePoints").textContent = formatPoints(points);

        if (state.profile.is_admin) {
            addAdminButton();
        } else {
            const adminButton = $("openAdminBtn");
            if (adminButton) adminButton.remove();
        }
    }

    function addAdminButton() {
        if ($("openAdminBtn")) return;

        const button = document.createElement("button");

        button.id = "openAdminBtn";
        button.className = "btn btn-outline";
        button.textContent = "QUẢN TRỊ TỪ VỰNG";
        button.style.margin = "15px 0";

        button.addEventListener("click", () => {
            showScreen("adminScreen");
        });

        $("homeScreen").appendChild(button);
    }

    // ======================================
    // 6. ACCOUNT SETTINGS
    // ======================================

    async function editNickname() {
        if (!state.user || !state.profile) return;

        const currentName =
            state.profile.nickname || "";

        const input = prompt(
            "Nhập biệt danh mới (2-24 ký tự):",
            currentName
        );

        if (input === null) return;

        const nickname = input.trim();

        if (nickname.length < 2 || nickname.length > 24) {
            showNotification(
                "Biệt danh phải có từ 2 đến 24 ký tự.",
                "error"
            );
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .from("profiles")
                .update({ nickname })
                .eq("user_id", state.user.id)
                .select("*")
                .single();

            if (error) throw error;

            state.profile = data;
            renderProfile();

            showNotification(
                "Đã cập nhật biệt danh.",
                "success"
            );

        } catch (error) {
            handleError(error, "Không thể đổi biệt danh");
        }
    }

    async function switchPlayer() {
        if (state.room) {
            showNotification(
                "Bạn cần rời phòng trước khi đổi người chơi.",
                "error"
            );
            return;
        }

        const confirmed = confirm(
            "Đổi sang người chơi mới?\n\n" +
            "Tài khoản hiện tại và điểm của tài khoản đó vẫn được giữ trong hệ thống.\n" +
            "Trình duyệt này sẽ đăng nhập bằng một tài khoản ẩn danh mới."
        );

        if (!confirmed) return;

        const button = $("switchPlayerBtn");

        if (button) {
            button.disabled = true;
            button.textContent = "ĐANG ĐỔI...";
        }

        try {
            clearInterval(state.timerInterval);
            stopQuestionTimer();
            unsubscribeRoom();

            const { error: signOutError } =
                await supabaseClient.auth.signOut({
                    scope: "local"
                });

            if (signOutError) throw signOutError;

            state.user = null;
            state.profile = null;
            state.room = null;
            state.players = [];
            state.question = null;
            state.selectedAnswer = null;
            state.hasBet = false;
            state.isHost = false;
            state.isSpectator = false;
            state.questionNumber = 1;

            const { data, error } =
                await supabaseClient.auth.signInAnonymously();

            if (error) throw error;

            if (!data || !data.user) {
                throw new Error(
                    "Supabase không trả về tài khoản người chơi mới."
                );
            }

            state.user = data.user;

            await loadProfile();

            showScreen("homeScreen");

            showNotification(
                "Đã chuyển sang người chơi mới.",
                "success"
            );

        } catch (error) {
            handleError(error, "Không thể đổi người chơi");

        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "ĐỔI NGƯỜI CHƠI";
            }
        }
    }

    // ======================================
    // 7. PROFILE AND PLAYER DATA
    // ======================================

    async function refreshProfile() {
        await loadProfile();

        if (!state.room) return;

        const player = state.players.find(
            item => item.user_id === state.user.id
        );

        if (player) {
            state.isSpectator = !!player.is_spectator;

            $("gameMyPoints").textContent =
                formatPoints(player.points);

            $("availableBetPoints").textContent =
                formatPoints(player.points);

            $("gamePlayerStatus").textContent =
                state.isSpectator
                    ? "Khán giả"
                    : "Đang chơi";

            if (player.points <= 0 || player.is_spectator) {
                disableBetting(
                    "Bạn đã hết điểm và chuyển sang chế độ khán giả."
                );
            }
        }
    }

    // ======================================
    // 8. CREATE ROOM
    // ======================================

    async function createRoom() {
        const duration = Number($("roomDuration").value);

        setButtonLoading(
            "createRoomBtn",
            true,
            "ĐANG TẠO PHÒNG..."
        );

        try {
            const { data, error } = await supabaseClient.rpc(
                "create_auction_room",
                {
                    p_duration: duration
                }
            );

            if (error) throw error;

            const result = getRpcData({ data });

            if (typeof result === "string") {
                await enterRoomByIdOrCode(result);

            } else if (
                result?.id ||
                result?.room_id ||
                result?.code
            ) {
                await enterRoomByIdOrCode(
                    result.id ||
                    result.room_id ||
                    result.code
                );

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
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            throw new Error("Không tìm thấy phòng vừa tạo.");
        }

        await openRoom(data);
    }

    // ======================================
    // 9. JOIN ROOM
    // ======================================

    async function joinRoom() {
        const code =
            $("joinRoomCode").value.trim().toUpperCase();

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
            const { data, error } = await supabaseClient.rpc(
                "join_auction_room",
                {
                    p_room_code: code
                }
            );

            if (error) throw error;

            const result = getRpcData({ data });

            if (result?.id || result?.room_id) {
                await enterRoomByIdOrCode(
                    result.id || result.room_id
                );
            } else {
                await enterRoomByIdOrCode(code);
            }

            showNotification(
                "Tham gia phòng thành công!",
                "success"
            );

        } catch (error) {
            handleError(error, "Không thể tham gia phòng");

        } finally {
            setButtonLoading("joinRoomBtn", false);
        }
    }

    async function enterRoomByIdOrCode(value) {
        let query = supabaseClient
            .from("auction_rooms")
            .select("*");

        if (String(value).length === 36) {
            query = query.eq("id", value);
        } else {
            query = query.eq("code", value);
        }

        const { data, error } = await query.single();

        if (error) throw error;

        await openRoom(data);
    }

    // ======================================
    // 10. OPEN ROOM
    // ======================================

    async function openRoom(room) {
        state.room = room;
        state.isHost = room.host_id === state.user.id;

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
            .order("joined_at", { ascending: true });

        if (error) throw error;

        state.players = data || [];

        renderWaitingPlayers();
        renderLeaderboard();
    }

    function renderWaitingRoom() {
        $("waitingRoomCode").textContent = state.room.code;

        $("waitingDuration").textContent =
            state.room.duration_minutes + " phút";

        $("waitingStatus").textContent = "Đang chờ";

        $("startGameBtn").style.display =
            state.isHost ? "inline-block" : "none";

        $("waitingHelpText").textContent = state.isHost
            ? "Bạn là chủ phòng. Có thể bắt đầu trận đấu."
            : "Đang chờ chủ phòng bắt đầu trận đấu.";
    }

    function renderWaitingPlayers() {
        if (!$("waitingPlayerCount")) return;

        $("waitingPlayerCount").textContent =
            state.players.length + " người";

        $("waitingPlayerList").innerHTML = "";

        state.players.forEach((player, index) => {
            const profileName =
                player.nickname || player.user_id.slice(0, 8);

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

            $("waitingPlayerList").appendChild(item);
        });
    }

    // ======================================
    // 11. REALTIME SUBSCRIPTIONS
    // ======================================

    function unsubscribeRoom() {
        state.subscriptions.forEach(channel => {
            supabaseClient.removeChannel(channel);
        });

        state.subscriptions = [];
    }

    function subscribeRoom() {
        unsubscribeRoom();

        if (!state.room) return;

        const roomChannel = supabaseClient
            .channel("room-" + state.room.id)

            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "auction_rooms",
                    filter: "id=eq." + state.room.id
                },
                async payload => {
                    if (!payload.new) return;

                    state.room = payload.new;

                    if (payload.new.status === "active") {
                        showScreen("gameScreen");

                        await loadCurrentQuestion();

                        startTimer();
                    }

                    if (payload.new.status === "finished") {
                        await showFinalResults();
                    }
                }
            )

            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "auction_players",
                    filter: "room_id=eq." + state.room.id
                },
                async () => {
                    await refreshPlayers();
                    await refreshProfile();
                }
            )

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "auction_questions",
                    filter: "room_id=eq." + state.room.id
                },
                async payload => {
                    if (!payload.new) return;

                    // Bỏ qua câu hỏi đã được tải trước đó.
                    if (
                        state.question?.id === payload.new.id
                    ) return;

                    state.question = payload.new;

                    state.questionNumber =
                        payload.new.sequence_no ||
                        state.questionNumber + 1;

                    state.selectedAnswer = null;
                    state.hasBet = false;
                    state.isSubmittingBet = false;

                    stopQuestionTimer();

                    renderQuestion();

                    await checkMyBet();
                }
            )

            .subscribe(status => {
                console.log("Realtime status:", status);
            });

        state.subscriptions.push(roomChannel);
    }

    // ======================================
    // 12. START GAME
    // ======================================

    async function startGame() {
        if (!state.isHost) return;

        setButtonLoading(
            "startGameBtn",
            true,
            "ĐANG BẮT ĐẦU..."
        );

        try {
            const { error } = await supabaseClient.rpc(
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

            if (questionError) throw questionError;

            showScreen("gameScreen");

            await refreshPlayers();
            await loadCurrentQuestion();

            startTimer();

            showNotification(
                "Trận đấu đã bắt đầu!",
                "success"
            );

        } catch (error) {
            handleError(error, "Không thể bắt đầu trận đấu");

        } finally {
            setButtonLoading("startGameBtn", false);
        }
    }

    // ======================================
    // 13. QUESTIONS
    // ======================================

    async function loadCurrentQuestion() {
        if (!state.room) return;

        const { data, error } = await supabaseClient
            .from("auction_questions")
            .select("*")
            .eq("room_id", state.room.id)
            .order("sequence_no", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (!data) return;

        // Không tải lại cùng một câu hỏi.
        if (state.question?.id === data.id) {
            await checkMyBet();
            return;
        }

        state.question = data;

        state.questionNumber = data.sequence_no || 1;

        state.selectedAnswer = null;
        state.hasBet = false;
        state.isSubmittingBet = false;

        stopQuestionTimer();

        renderQuestion();

        await checkMyBet();
    }

    function renderQuestion() {
        if (!state.question) return;

        const question = state.question;

        $("gameRoomCode").textContent = state.room.code;

        $("questionNumber").textContent =
            "CÂU HỎI #" +
            (question.sequence_no || state.questionNumber);

        $("questionWord").textContent =
            question.tu_vung ||
            question.word ||
            question.english_word ||
            "---";

        $("questionPhonetic").textContent =
            question.phien_am ||
            question.phonetic ||
            "";

        $("questionType").textContent =
            question.tu_loai ||
            question.word_type ||
            "";

        const options = question.options || [];

        $("answerOptions").innerHTML = "";

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
                    : option.nghia_tieng_viet ||
                      option.nghiaTiengViet ||
                      option.text ||
                      "";

            button.append(letter, text);

            button.addEventListener("click", () => {
                selectAnswer(index);
            });

            $("answerOptions").appendChild(button);
        });

        const player = state.players.find(
            item => item.user_id === state.user.id
        );

        const currentPoints = Number(
            player?.points ??
            state.profile?.points ??
            1000
        );

        const savedBet = getSavedBetAmount();

        $("betAmount").value = Math.min(
            savedBet,
            currentPoints
        );

        $("betMessage").textContent =
            "Chọn số điểm cược rồi chọn đáp án. Hệ thống tự động gửi.";

        enableBetting();
        updateBetAvailability();

        startQuestionTimer();
    }

    function selectAnswer(index) {
        if (
            state.hasBet ||
            state.isSpectator ||
            state.isSubmittingBet
        ) return;

        state.selectedAnswer = index;

        document.querySelectorAll(".answer-option").forEach(button => {
            button.classList.toggle(
                "selected",
                Number(button.dataset.index) === index
            );
        });

        // Dừng đồng hồ ngay khi chọn đáp án.
        stopQuestionTimer();

        const countdown = $("questionCountdown");

        if (countdown) {
            countdown.textContent = "ĐANG GỬI...";
        }

        submitBet(index, false);
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

            stopQuestionTimer();

            disableBetting(
                "Bạn đã đặt điểm cho câu hỏi này."
            );

            const countdown = $("questionCountdown");

            if (countdown) {
                countdown.textContent = "ĐÃ TRẢ LỜI";
                countdown.style.color = "#35dfa0";
            }
        }
    }

    // ======================================
    // 14. QUESTION TIMER - 10 SECONDS
    // ======================================

    function stopQuestionTimer() {
        clearInterval(state.questionTimerInterval);
        state.questionTimerInterval = null;

        clearTimeout(state.questionAdvanceTimeout);
        state.questionAdvanceTimeout = null;
    }

    function scheduleNextQuestion() {
        if (
            !state.isHost ||
            !state.room ||
            state.room.status !== "active"
        ) {
            return;
        }

        if (state.questionAdvanceTimeout) return;

        state.questionAdvanceTimeout = setTimeout(() => {
            state.questionAdvanceTimeout = null;
            nextQuestion();
        }, 3000);
    }

    function startQuestionTimer() {
        stopQuestionTimer();

        if (!state.question) return;

        if (state.hasBet || state.isSpectator) return;

        const createdAt = state.question.created_at
            ? new Date(state.question.created_at).getTime()
            : Date.now();

        state.questionDeadline = createdAt + 10000;

        const updateCountdown = async () => {
            const remaining = Math.max(
                0,
                Math.ceil(
                    (state.questionDeadline - Date.now()) / 1000
                )
            );

            const countdown = $("questionCountdown");

            if (countdown) {
                countdown.textContent = remaining + "s";

                countdown.style.color =
                    remaining <= 3 ? "#ff5878" : "";
            }

            if (remaining <= 0) {
                stopQuestionTimer();

                if (!state.hasBet && !state.isSpectator) {
                    await submitBet(null, true);
                }

                scheduleNextQuestion();
            }
        };

        updateCountdown();

        if (state.questionDeadline > Date.now()) {
            state.questionTimerInterval = setInterval(
                updateCountdown,
                250
            );
        } else {
            // Nếu tải câu hỏi muộn và đã hết 10 giây.
            if (!state.hasBet && !state.isSpectator) {
                submitBet(null, true);
            }

            scheduleNextQuestion();
        }
    }

    // ======================================
    // 15. BETTING
    // ======================================

    function updateBetAvailability() {
        const player = state.players.find(
            item => item.user_id === state.user.id
        );

        const points = Number(
            player?.points ??
            state.profile?.points ??
            1000
        );

        $("availableBetPoints").textContent =
            formatPoints(points);

        document.querySelectorAll(".bet-shortcut").forEach(button => {
            const amount = button.dataset.bet;

            if (amount === "1000") {
                button.textContent = "Tất cả";
            }
        });
    }

    function disableBetting(message) {
        document.querySelectorAll(".answer-option").forEach(button => {
            button.disabled = true;
        });

        if ($("betAmount")) {
            $("betAmount").disabled = true;
        }

        if ($("submitBetBtn")) {
            $("submitBetBtn").disabled = true;
        }

        if ($("betMessage")) {
            $("betMessage").textContent = message;
        }
    }

    function enableBetting() {
        if (state.isSpectator || state.hasBet) {
            disableBetting(
                state.isSpectator
                    ? "Bạn đang ở chế độ khán giả."
                    : "Bạn đã hoàn thành lượt cược."
            );
            return;
        }

        document.querySelectorAll(".answer-option").forEach(button => {
            button.disabled = false;
        });

        if ($("betAmount")) {
            $("betAmount").disabled = false;
        }

        if ($("submitBetBtn")) {
            $("submitBetBtn").disabled = true;
        }
    }

    async function submitBet(
        answerIndex = state.selectedAnswer,
        isTimeout = false
    ) {
        if (!state.question || !state.room) return;

        if (state.hasBet || state.isSubmittingBet) return;

        if (state.isSpectator) return;

        const betPoints = Number($("betAmount").value);

        if (!Number.isInteger(betPoints) || betPoints <= 0) {
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
            answerIndex !== null &&
            (
                !Number.isInteger(answerIndex) ||
                answerIndex < 0 ||
                answerIndex > 5
            )
        ) {
            showNotification(
                "Đáp án không hợp lệ.",
                "error"
            );
            return;
        }

        state.isSubmittingBet = true;

        stopQuestionTimer();

        saveBetAmount(betPoints);

        document.querySelectorAll(".answer-option").forEach(button => {
            button.disabled = true;
        });

        $("betAmount").disabled = true;

        if ($("submitBetBtn")) {
            $("submitBetBtn").disabled = true;
        }

        $("betMessage").textContent = isTimeout
            ? "Đã hết thời gian. Đang tự động xử lý điểm cược..."
            : "Đang gửi đáp án và điểm cược...";

        try {
            const { data, error } = await supabaseClient.rpc(
                "place_auction_bet",
                {
                    p_question_id: state.question.id,
                    p_answer_index: answerIndex,
                    p_bet_points: betPoints
                }
            );

            if (error) throw error;

            state.hasBet = true;

            // Chủ phòng trả lời sớm cũng tự chuyển câu.
            if (state.isHost) {
                scheduleNextQuestion();
            }

            const countdown = $("questionCountdown");

            if (countdown) {
                countdown.textContent = "ĐÃ TRẢ LỜI";
                countdown.style.color = "#35dfa0";
            }

            disableBetting(
                answerIndex === null
                    ? "Bạn không trả lời kịp. Điểm cược đã được xử lý."
                    : "Đã gửi đáp án và điểm cược."
            );

            const result = getRpcData({ data });

            if (answerIndex === null) {
                showNotification(
                    "Hết giờ! Bạn bị trừ " +
                    formatPoints(betPoints) +
                    " điểm.",
                    "error"
                );

            } else if (result?.is_correct === true) {
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
                    "Đã gửi đáp án thành công.",
                    "success"
                );
            }

            await refreshPlayers();
            await refreshProfile();

        } catch (error) {
            handleError(error, "Không thể gửi điểm cược");

            if (
                state.questionDeadline &&
                Date.now() < state.questionDeadline
            ) {
                enableBetting();
                startQuestionTimer();
            }

        } finally {
            state.isSubmittingBet = false;
        }
    }

    $("betAmount").addEventListener("change", () => {
        saveBetAmount($("betAmount").value);
    });

    // ======================================
    // 16. BET SHORTCUT BUTTONS
    // ======================================

    document.querySelectorAll(".bet-shortcut").forEach(button => {
        button.addEventListener("click", () => {
            const player = state.players.find(
                item => item.user_id === state.user.id
            );

            const points = Number(
                player?.points ??
                state.profile?.points ??
                1000
            );

            const value = button.dataset.bet;

            const selectedAmount =
                value === "1000"
                    ? points
                    : Math.min(Number(value), points);

            $("betAmount").value = selectedAmount;

            saveBetAmount(selectedAmount);
        });
    });

    // ======================================
    // 17. NEXT QUESTION
    // ======================================

    async function nextQuestion() {
        if (!state.isHost || state.isAdvancingQuestion) return;

        if (!state.room || state.room.status !== "active") return;

        state.isAdvancingQuestion = true;

        try {
            const { data, error } = await supabaseClient.rpc(
                "create_auction_question",
                {
                    p_room_id: state.room.id
                }
            );

            if (error) throw error;

            if (data?.error) {
                throw new Error(data.error);
            }

            // Realtime INSERT sẽ cập nhật câu hỏi cho tất cả người chơi.
            // Tải lại để phòng trường hợp Realtime chưa nhận sự kiện.
            await loadCurrentQuestion();

            console.log(
                "Đã tạo câu hỏi tiếp theo:",
                data
            );

        } catch (error) {
            console.error(
                "Lỗi chuyển câu hỏi:",
                error
            );

            showNotification(
                "Không thể chuyển câu hỏi: " + error.message,
                "error"
            );

        } finally {
            state.isAdvancingQuestion = false;
        }
    }

    // ======================================
    // 18. LEADERBOARD
    // ======================================

    function renderLeaderboard() {
        const sorted = [...state.players].sort(
            (a, b) => Number(b.points) - Number(a.points)
        );

        $("gamePlayerCount").textContent = sorted.length;

        $("gameLeaderboard").innerHTML = "";

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
                player.user_id.slice(0, 8);

            left.append(rank, name);

            const score = document.createElement("strong");
            score.textContent =
                formatPoints(player.points) + " điểm";

            item.append(left, score);

            $("gameLeaderboard").appendChild(item);
        });

        const me = state.players.find(
            player => player.user_id === state.user.id
        );

        if (me) {
            $("gameMyPoints").textContent =
                formatPoints(me.points);

            $("availableBetPoints").textContent =
                formatPoints(me.points);
        }
    }

    // ======================================
    // 19. MATCH TIMER
    // ======================================

    function startTimer() {
        clearInterval(state.timerInterval);

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

            $("gameTimer").textContent =
                String(minutes).padStart(2, "0") +
                ":" +
                String(seconds).padStart(2, "0");

            if (remaining <= 0) {
                clearInterval(state.timerInterval);

                if (state.isHost) {
                    finishGame();
                }
            }
        };

        update();

        state.timerInterval = setInterval(update, 1000);
    }

    // ======================================
    // 20. FINISH GAME
    // ======================================

    async function finishGame() {
        if (!state.isHost || !state.room) return;

        try {
            stopQuestionTimer();

            const { error } = await supabaseClient.rpc(
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
        }
    }

    async function showFinalResults() {
        clearInterval(state.timerInterval);
        stopQuestionTimer();

        await refreshPlayers();

        const sorted = [...state.players].sort(
            (a, b) => Number(b.points) - Number(a.points)
        );

        $("finalLeaderboard").innerHTML = "";

        sorted.forEach((player, index) => {
            const item = document.createElement("div");
            item.className = "leaderboard-item";

            const left = document.createElement("span");

            left.textContent =
                (index + 1) +
                ". " +
                (
                    player.nickname ||
                    player.user_id.slice(0, 8)
                );

            const score = document.createElement("strong");

            score.textContent =
                formatPoints(player.points) + " điểm";

            item.append(left, score);

            $("finalLeaderboard").appendChild(item);
        });

        showScreen("resultScreen");
    }

    // ======================================
    // 21. LEAVE ROOM
    // ======================================

    async function leaveRoom() {
        if (!state.room) {
            showScreen("homeScreen");
            return;
        }

        try {
            const { error } = await supabaseClient.rpc(
                "leave_auction_room",
                {
                    p_room_id: state.room.id
                }
            );

            if (error) throw error;

            clearInterval(state.timerInterval);
            stopQuestionTimer();

            unsubscribeRoom();

            state.room = null;
            state.players = [];
            state.question = null;
            state.hasBet = false;
            state.isSpectator = false;
            state.isHost = false;

            await refreshProfile();

            showScreen("homeScreen");

            showNotification(
                "Đã rời phòng.",
                "success"
            );

        } catch (error) {
            handleError(error, "Không thể rời phòng");
        }
    }

    // ======================================
    // 22. ADMIN - IMPORT VOCABULARY
    // ======================================

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
                $("vocabularyJson").value
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
            const { data, error } = await supabaseClient.rpc(
                "import_vocabulary",
                {
                    p_data: vocabulary
                }
            );

            if (error) throw error;

            $("importMessage").textContent =
                "Đã gửi dữ liệu nhập từ vựng thành công.";

            showNotification(
                "Nhập từ vựng thành công!",
                "success"
            );

            console.log("Import result:", data);

        } catch (error) {
            handleError(
                error,
                "Không thể nhập từ vựng"
            );

            $("importMessage").textContent =
                error.message;

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

            $("vocabularyJson").value = text;

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

    // ======================================
    // 23. EVENT LISTENERS
    // ======================================

    $("editNicknameBtn").addEventListener(
        "click",
        editNickname
    );

    $("switchPlayerBtn").addEventListener(
        "click",
        switchPlayer
    );

    $("createRoomBtn").addEventListener(
        "click",
        createRoom
    );

    $("joinRoomBtn").addEventListener(
        "click",
        joinRoom
    );

    $("startGameBtn").addEventListener(
        "click",
        startGame
    );

    $("leaveWaitingBtn").addEventListener(
        "click",
        leaveRoom
    );

    $("leaveGameBtn").addEventListener(
        "click",
        leaveRoom
    );

    $("backHomeBtn").addEventListener("click", () => {
        clearInterval(state.timerInterval);
        stopQuestionTimer();

        state.room = null;
        state.question = null;

        unsubscribeRoom();

        showScreen("homeScreen");

        refreshProfile();
    });

    $("adminBackBtn").addEventListener("click", () => {
        showScreen("homeScreen");
    });

    $("importVocabularyBtn").addEventListener(
        "click",
        importVocabulary
    );

    $("vocabularyFile").addEventListener(
        "change",
        event => {
            loadVocabularyFile(event.target.files[0]);
        }
    );

    // ======================================
    // 24. INITIALIZE APPLICATION
    // ======================================

    async function initializeApp() {
        await initializeAuth();

        console.log("Word Auction initialized.");
    }

    initializeApp();

})();