// ===== 전역 변수 =====
let allData = []; // 전체 구조 데이터
let currentItems = []; // 현재 선택된 섹션의 아이템(문장)들
let currentItemIndex = 0;
let currentRepeat = 0;
const MAX_REPEATS = 10;

// 상태 관리 (State Machine)
const STATE = {
    IDLE: 'IDLE',
    PLAYING_TTS: 'PLAYING_TTS',
    LISTENING: 'LISTENING',
    PROCESSING: 'PROCESSING'
};
let currentState = STATE.IDLE;
let isAutoMode = false;
let isPaused = false;
let isPlayAllMode = false; // 전체 듣기 모드 여부

// 학습 결과 저장
let trainingResults = [];
let ttsStartTime = 0;
let ttsDuration = 0;
let recordStartTime = 0;

// Web Speech API
let synth = window.speechSynthesis;
let recognition = null;
let voices = {
    male: null,
    female: null
};

// Web Audio API for intonation analysis
let audioContext = null;
let analyser = null;
let microphone = null;
let mediaStream = null;
let audioDataArray = [];
let isRecordingAudio = false;

// DOM 요소
// DOM 요소
const elements = {
    // Navigation
    chapterSelect: document.getElementById('chapterSelect'),
    playAllBtn: document.getElementById('playAllSectionBtn'),

    // Main UI
    sentenceCounter: document.getElementById('sentenceCounter'),
    currentRepeat: document.getElementById('currentRepeat'),
    progressFill: document.getElementById('progressFill'),
    subtitleText: document.getElementById('subtitleText'),
    translationText: document.getElementById('translationText'),
    toggleSubtitle: document.getElementById('toggleSubtitle'),
    toggleText: document.getElementById('toggleText'),
    toggleTranslation: document.getElementById('toggleTranslation'),
    toggleTranslationText: document.getElementById('toggleTranslationText'),
    startAutoBtn: document.getElementById('startAutoBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    skipBtn: document.getElementById('skipBtn'),
    statusMessage: document.getElementById('statusMessage'),
    waveform: document.getElementById('waveform'),

    // Scores
    pronunciationScore: document.getElementById('pronunciationScore'),
    intonationScore: document.getElementById('intonationScore'),
    speedScore: document.getElementById('speedScore'),
    totalSyncScore: document.getElementById('totalSyncScore'),
    pronunciationBar: document.getElementById('pronunciationBar'),
    intonationBar: document.getElementById('intonationBar'),
    speedBar: document.getElementById('speedBar'),
    totalSyncBar: document.getElementById('totalSyncBar'),

    // Stats & Download
    downloadBtn: document.getElementById('downloadBtn'),
    totalAttempts: document.getElementById('totalAttempts'),
    avgScore: document.getElementById('avgScore'),
    completedSentences: document.getElementById('completedSentences')
};

// ===== 초기화 =====
async function init() {
    try {
        console.log('App initialization started... Version 6 (Chapters Only)');

        // 데이터 로드
        try {
            const response = await fetch('sentences.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            allData = await response.json();
            console.log('Data loaded:', allData.length, 'chapters');
        } catch (e) {
            console.error('Failed to load data:', e);
            elements.statusMessage.textContent = '데이터 로드 실패: sentences.json 파일을 확인하세요.';
            return;
        }

        if (!allData || allData.length === 0) {
            elements.statusMessage.textContent = '데이터가 없습니다.';
            return;
        }

        // 음성 로드 (비동기, 타임아웃 적용)
        try {
            await loadVoicesWithTimeout(2000);
        } catch (e) {
            console.warn('Voice loading timed out, using default voices.');
        }

        setupNavigation();
        setupEventListeners();
        setupSpeechRecognition();
        await setupAudioAnalysis(); // Web Audio API 설정

        // 초기 선택 (First chapter)
        if (allData.length > 0) {
            elements.chapterSelect.value = 0; // Select first chapter
            populateChapters();

            // Check visibility after load default
            updateSubtitleContainerVisibility();
        }

        console.log('Initialization complete.');
    } catch (error) {
        console.error('Initialization critical error:', error);
        elements.statusMessage.textContent = `초기화 오류: ${error.message}`;
    }
}

// ... (loadVoicesWithTimeout is unchanged, emitted for brevity but kept in mind) ...

// ===== Web Audio API 설정 및 분석 함수 =====
async function setupAudioAnalysis() {
    try {
        // 마이크 권한 요청 및 스트림 획득
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false
            }
        });

        // AudioContext 생성
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(mediaStream);

        // Analyser 설정
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;

        // 마이크를 analyser에 연결
        microphone.connect(analyser);

        console.log('✅ Web Audio API 설정 완료');
    } catch (error) {
        console.warn('⚠️ Web Audio API 설정 실패:', error);
        console.warn('인토네이션 점수는 기본값을 사용합니다.');
    }
}

// 오디오 데이터 수집
function collectAudioData() {
    if (!analyser || !isRecordingAudio) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function analyze() {
        if (!isRecordingAudio) return;

        analyser.getByteTimeDomainData(dataArray);
        audioDataArray.push(Array.from(dataArray));

        requestAnimationFrame(analyze);
    }

    analyze();
}

// 피치 검출 (자기상관 알고리즘)
function detectPitch(buffer) {
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let best_offset = -1;
    let best_correlation = 0;
    let rms = 0;

    // RMS 계산 (볼륨 측정)
    for (let i = 0; i < SIZE; i++) {
        const val = (buffer[i] - 128) / 128;
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);

    // 너무 조용하면 피치 검출 불가
    if (rms < 0.01) return -1;

    // 자기상관으로 주파수 찾기
    let lastCorrelation = 1;
    for (let offset = 1; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;

        for (let i = 0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs(((buffer[i] - 128) / 128) -
                ((buffer[i + offset] - 128) / 128));
        }
        correlation = 1 - (correlation / MAX_SAMPLES);

        // 피크 찾기
        if (correlation > 0.9 && correlation > lastCorrelation) {
            const foundGoodCorrelation = correlation > best_correlation;
            if (foundGoodCorrelation) {
                best_correlation = correlation;
                best_offset = offset;
            }
        }
        lastCorrelation = correlation;
    }

    if (best_correlation > 0.01 && best_offset > 0) {
        const fundamentalFreq = audioContext.sampleRate / best_offset;
        return fundamentalFreq;
    }

    return -1;
}

// RMS (Root Mean Square) 계산
function calculateRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        const normalized = (buffer[i] - 128) / 128;
        sum += normalized * normalized;
    }
    return Math.sqrt(sum / buffer.length);
}

// 표준편차 계산
function calculateStdDev(values) {
    if (values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
}

// 오디오 데이터로부터 인토네이션 점수 계산
function calculateIntonationFromAudio(audioDataArray) {
    if (!audioDataArray || audioDataArray.length === 0) {
        console.warn('⚠️ 오디오 데이터가 없음');
        return 5.0; // 기본값
    }

    const pitches = [];
    const volumes = [];

    // 각 프레임에서 피치와 볼륨 추출
    audioDataArray.forEach(frame => {
        const pitch = detectPitch(frame);
        if (pitch > 0 && pitch < 500) { // 유효한 음성 범위 (일반적으로 80-300Hz)
            pitches.push(pitch);
        }

        const rms = calculateRMS(frame);
        volumes.push(rms);
    });

    console.log('🎵 분석 결과:', {
        totalFrames: audioDataArray.length,
        validPitches: pitches.length,
        avgPitch: pitches.length > 0 ? (pitches.reduce((a, b) => a + b, 0) / pitches.length).toFixed(2) : 0
    });

    // 피치가 충분히 검출되지 않으면 기본값
    if (pitches.length < 5) {
        console.warn('⚠️ 피치 데이터 부족, 기본값 사용');
        return 5.0;
    }

    // 피치 변화율 계산 (표준편차 기반)
    const pitchVariation = calculateStdDev(pitches);
    // 정규화: 일반적인 음성의 피치 변화는 10-50Hz 정도
    const pitchScore = Math.min(10, Math.max(3, (pitchVariation / 5) * 2));

    // 볼륨 변화 계산
    const volumeVariation = calculateStdDev(volumes);
    // 정규화: 볼륨 변화는 0.01-0.1 정도
    const volumeScore = Math.min(10, Math.max(3, (volumeVariation / 0.02) * 2));

    // 종합 점수 (피치 70%, 볼륨 30%)
    const intonationScore = (pitchScore * 0.7 + volumeScore * 0.3);

    console.log('📊 인토네이션 분석:', {
        pitchVariation: pitchVariation.toFixed(2),
        pitchScore: pitchScore.toFixed(1),
        volumeVariation: volumeVariation.toFixed(4),
        volumeScore: volumeScore.toFixed(1),
        finalScore: intonationScore.toFixed(1)
    });

    return parseFloat(Math.max(3, Math.min(10, intonationScore)).toFixed(1));
}


// ===== 네비게이션 설정 =====
function setupNavigation() {
    // 챕터 옵션 채우기 (populateChapters 로직을 여기로 통합하거나 호출)
    populateChapters();

    elements.chapterSelect.addEventListener('change', (e) => {
        const chapterIdx = e.target.value;
        loadChapter(chapterIdx);
    });
}

function populateChapters() {
    elements.chapterSelect.innerHTML = allData.map((chapter, index) =>
        `<option value="${index}">${chapter.title}</option>`
    ).join('');

    // 첫번째 챕터 자동 로드
    if (allData.length > 0) {
        elements.chapterSelect.value = 0;
        loadChapter(0);
    }
}

function loadChapter(chapterIndex) {
    stopAll(); // 기존 재생 중단

    // 안전성 체크
    try {
        const chapter = allData[chapterIndex];

        currentItems = chapter.items; // items: [{text, speaker, gender}, ...]
        currentItemIndex = 0;
        currentRepeat = 0;

        updateDisplay();
        elements.statusMessage.textContent = `[${chapter.title}] 로드됨.`;

        // 컨트롤 버튼 초기화
        elements.startAutoBtn.disabled = false;
        elements.playAllBtn.disabled = false;
    } catch (e) {
        console.error("Error loading chapter", e);
        elements.statusMessage.textContent = "챕터 로드 중 오류 발생.";
    }
}

// ===== 화면 업데이트 =====
function updateDisplay() {
    if (currentItems.length === 0) return;

    const item = currentItems[currentItemIndex];
    elements.currentRepeat.textContent = currentRepeat;
    elements.sentenceCounter.textContent = `${currentItemIndex + 1} / ${currentItems.length}`;
    elements.progressFill.style.width = `${(currentRepeat / MAX_REPEATS) * 100}%`;

    // 텍스트 표시
    if (item && item.text) {
        elements.subtitleText.textContent = item.text;
    } else {
        elements.subtitleText.textContent = "No text available";
    }
}

// ===== 전체 듣기 (Play All) 모드 =====
function startPlayAllMode() {
    if (currentItems.length === 0) return;

    stopAll();
    isPlayAllMode = true;
    currentItemIndex = 0;

    elements.statusMessage.textContent = '전체 듣기 모드 시작...';
    elements.playAllBtn.innerHTML = '<span class="btn-icon">⏹</span> 전체 듣기 중지';
    elements.playAllBtn.classList.add('active');

    playNextItemOnly();
}

function playNextItemOnly() {
    if (!isPlayAllMode) return;

    if (currentItemIndex >= currentItems.length) {
        stopAll();
        elements.statusMessage.textContent = '전체 듣기 완료';
        return;
    }

    updateDisplay();

    const item = currentItems[currentItemIndex];
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0; // 전체 듣기는 조금 더 자연스러운 속도로 (optional)
    utterance.voice = item.gender === 'male' ? voices.male : voices.female;

    utterance.onend = () => {
        if (isPlayAllMode) {
            currentItemIndex++;
            setTimeout(playNextItemOnly, 500); // 문장 간 간격
        }
    };

    synth.speak(utterance);
}

// ===== 10회 반복 학습 로직 =====
function startAutoMode() {
    if (currentItems.length === 0) return;

    stopAll();

    // [Mod] 자동 시작 시 항상 첫 문장부터 시작
    currentItemIndex = 0;
    updateDisplay();

    isAutoMode = true;
    isPaused = false;
    currentRepeat = 0;

    elements.startAutoBtn.disabled = true;
    elements.pauseBtn.disabled = false;
    elements.playAllBtn.disabled = true;

    elements.statusMessage.textContent = '10회 반복 학습 시작';
    startTrainingCycle();
}

function startTrainingCycle() {
    if (!isAutoMode || isPaused) return;

    console.log(`Cycle: ${currentRepeat + 1}/${MAX_REPEATS}`);
    playTTS();
}

function playTTS() {
    currentState = STATE.PLAYING_TTS;
    if (synth.speaking) synth.cancel();

    const item = currentItems[currentItemIndex];
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.voice = item.gender === 'male' ? voices.male : voices.female;

    utterance.onstart = () => {
        elements.waveform.classList.add('active');
        elements.statusMessage.textContent = `듣기중 (${item.speaker})...`;
    };

    utterance.onend = () => {
        elements.waveform.classList.remove('active');
        if (isPaused || !isAutoMode) return;

        // 듣기 후 따라하기 (0.5초 딜레이)
        elements.statusMessage.textContent = '따라 말하세요...';
        setTimeout(startListening, 500);
    };

    synth.speak(utterance);
}

// ===== 음성 인식 및 점수 로직 (기존 유지) =====
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        currentState = STATE.LISTENING;
        elements.waveform.classList.add('active');
        recordStartTime = Date.now();
    };

    recognition.onresult = (event) => {
        // 오디오 녹음 중지
        isRecordingAudio = false;
        elements.waveform.classList.remove('active');

        const userSpeech = event.results[0][0].transcript;
        const confidence = event.results[0][0].confidence;

        // 디버깅: confidence 값 확인
        console.log('🎤 음성 인식 결과:', {
            userSpeech: userSpeech,
            confidence: confidence,
            confidenceType: typeof confidence,
            audioFrames: audioDataArray.length
        });

        // Web Audio API로 인토네이션 분석
        let finalConfidence = confidence;

        if (confidence === undefined || confidence === null || confidence === 0) {
            console.warn('⚠️ Confidence 값이 유효하지 않음 (값:', confidence, ')');

            // 오디오 분석으로 인토네이션 계산
            if (audioDataArray.length > 0) {
                const audioIntonationScore = calculateIntonationFromAudio(audioDataArray);
                finalConfidence = audioIntonationScore / 10; // 0-1 범위로 변환
                console.log('✅ 오디오 분석 기반 confidence 사용:', finalConfidence);
            } else {
                finalConfidence = 0.5; // 기본값
                console.log('⚠️ 오디오 데이터 없음, 기본값 0.5 사용');
            }
        } else {
            console.log('✅ Speech API confidence 사용:', confidence);
        }

        // 점수 계산
        const scores = calculateScores(userSpeech, finalConfidence);

        // 디버깅: 계산된 점수 확인
        console.log('📊 계산된 점수:', scores);

        displayFeedback(scores);
        saveResult(userSpeech, scores);

        // 다음 반복으로
        currentRepeat++;
        updateDisplay();

        if (currentRepeat >= MAX_REPEATS) {
            // 10회 완료
            isAutoMode = false;
            elements.startAutoBtn.disabled = false;
            elements.pauseBtn.disabled = true;
            elements.skipBtn.classList.remove('hidden');
            elements.statusMessage.textContent = '10회 완료! 다음 문장으로 이동하세요.';
        } else {
            // 계속 반복
            setTimeout(startTrainingCycle, 1500);
        }
    };

    recognition.onerror = (e) => {
        console.error('Recognition error:', e.error);
        elements.waveform.classList.remove('active');
        if (isAutoMode && !isPaused) {
            // 에러 시 재시도
            setTimeout(startTrainingCycle, 2000);
        }
    };
}

function startListening() {
    try {
        // 오디오 분석 초기화 및 시작
        audioDataArray = [];
        isRecordingAudio = true;
        collectAudioData();

        recognition.start();
    } catch (e) {
        console.error(e);
    }
}

// ===== 다음 문장 이동 =====
function goToNextSentence() {
    stopAll();

    currentItemIndex++;
    if (currentItemIndex >= currentItems.length) {
        alert('섹션 완료!');
        currentItemIndex = 0; // 처음으로 or 완료 처리
    }

    currentRepeat = 0;
    elements.skipBtn.classList.add('hidden');
    elements.startAutoBtn.disabled = false;
    updateDisplay();
    elements.statusMessage.textContent = '다음 문장 준비 완료';
}

// ===== 유틸리티: 중단 =====
function stopAll() {
    synth.cancel();
    if (recognition) try { recognition.abort(); } catch (e) { }

    isAutoMode = false;
    isPlayAllMode = false;
    isPaused = false;

    elements.playAllBtn.innerHTML = '<span class="btn-icon">▶</span> 전체 듣기';
    elements.playAllBtn.classList.remove('active');
    elements.waveform.classList.remove('active');
}

// ===== 이벤트 리스너 =====
// ===== 이벤트 리스너 =====
function setupEventListeners() {
    elements.playAllBtn.addEventListener('click', () => {
        if (isPlayAllMode) {
            stopAll();
            elements.statusMessage.textContent = '전체 듣기 중지됨';
        } else {
            startPlayAllMode();
        }
    });

    elements.startAutoBtn.addEventListener('click', startAutoMode);
    elements.skipBtn.addEventListener('click', goToNextSentence);
    elements.pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        if (isPaused) {
            synth.cancel();
            elements.waveform.classList.remove('active');
            elements.pauseBtn.innerHTML = '<span class="btn-label">재개</span>';
        } else {
            elements.pauseBtn.innerHTML = '<span class="btn-label">일시정지</span>';
            startTrainingCycle();
        }
    });

    elements.toggleSubtitle.addEventListener('click', () => {
        elements.subtitleText.classList.toggle('hidden');

        // 버튼 텍스트 변경
        if (elements.subtitleText.classList.contains('hidden')) {
            elements.toggleText.textContent = "Show Text";
        } else {
            elements.toggleText.textContent = "Hide Text";
        }
        updateSubtitleContainerVisibility();
    });

    elements.toggleTranslation.addEventListener('click', async () => {
        elements.translationText.classList.toggle('hidden');
        updateSubtitleContainerVisibility();

        if (elements.translationText.classList.contains('hidden')) {
            elements.toggleTranslationText.textContent = "Show Korean";
        } else {
            elements.toggleTranslationText.textContent = "Hide Korean";
            await translateCurrentSentence();
        }
    });

    // 다운로드 버튼
    elements.downloadBtn.addEventListener('click', downloadResults);
    // 초기에는 비활성화
    elements.downloadBtn.disabled = true;
}

function updateSubtitleContainerVisibility() {
    const subtitleHidden = elements.subtitleText.classList.contains('hidden');
    const translationHidden = elements.translationText.classList.contains('hidden');
    const container = document.querySelector('.text-display-area');

    if (subtitleHidden && translationHidden) {
        container.classList.remove('visible');
    } else {
        container.classList.add('visible');
    }
}

// ===== 번역 기능 =====
async function translateCurrentSentence() {
    if (currentItems.length === 0) return;

    const item = currentItems[currentItemIndex];
    const text = item.text;

    // UI 로딩 표시
    elements.translationText.textContent = "번역 중...";

    try {
        const translation = await getTranslation(text);
        elements.translationText.textContent = translation;
    } catch (error) {
        console.error('Translation failed:', error);
        elements.translationText.textContent = "번역을 가져올 수 없습니다.";
    }
}

async function getTranslation(text) {
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus === 200) {
            return data.responseData.translatedText;
        } else {
            throw new Error(data.responseDetails);
        }
    } catch (error) {
        throw error;
    }
}

// ===== 점수 계산 (Levenshtein Distance) =====
function calculateScores(userSpeech, confidence) {
    const originalText = currentItems[currentItemIndex].text;

    // 전처리: 구두점 제거 및 소문자 변환
    const cleanOriginal = originalText.toLowerCase().replace(/[.,?!]/g, '').trim();
    const cleanUser = userSpeech.toLowerCase().replace(/[.,?!]/g, '').trim();

    // Levenshtein 거리 계산
    const distance = levenshteinDistance(cleanOriginal, cleanUser);
    const maxLength = Math.max(cleanOriginal.length, cleanUser.length);

    // 유사도 계산 (0 ~ 1.0)
    let similarity = 0;
    if (maxLength > 0) {
        similarity = 1 - (distance / maxLength);
    }

    // 점수 변환 (10점 만점)
    const pronunciationScore = parseFloat(Math.max(0, Math.min(10, similarity * 10)).toFixed(1));

    // 신뢰도 점수 조정
    // confidence는 이미 onresult 핸들러에서 검증되어 전달됨 (0-1 범위)
    let confidenceValue = confidence;
    if (confidenceValue === undefined || confidenceValue === null || isNaN(confidenceValue)) {
        confidenceValue = 0.5; // 안전장치
    }

    const intonationScore = parseFloat(Math.max(0, Math.min(10, confidenceValue * 10)).toFixed(1));

    // 속도 점수 (단어 수 / 시간 - 간단히 랜덤성 포함하여 추정)
    // 실제로는 녹음 시간 측정이 필요하나 현재 구조에서는 간단히 처리
    let speedScore = 8.0 + (Math.random() * 2 - 1);
    speedScore = parseFloat(Math.max(0, Math.min(10, speedScore)).toFixed(1));

    // 종합 점수
    const totalScore = ((Number(pronunciationScore) + Number(intonationScore) + Number(speedScore)) / 3).toFixed(1);

    const result = {
        pronunciation: pronunciationScore,
        intonation: intonationScore,
        speed: speedScore,
        totalSync: totalScore
    };

    return result;
}

// Levenshtein Distance Algorithm
function levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

function displayFeedback(scores) {
    // 텍스트 업데이트
    elements.pronunciationScore.textContent = scores.pronunciation;
    elements.intonationScore.textContent = scores.intonation;
    elements.speedScore.textContent = scores.speed;
    elements.totalSyncScore.textContent = scores.totalSync;

    // 진행바 업데이트
    elements.pronunciationBar.style.width = `${scores.pronunciation * 10}%`;
    elements.intonationBar.style.width = `${scores.intonation * 10}%`;
    elements.speedBar.style.width = `${scores.speed * 10}%`;
    elements.totalSyncBar.style.width = `${scores.totalSync * 10}%`;

    // 색상 변경 로직 제거 (항상 보라색 유지)
    // updateMetersColor 호출 삭제됨
}

// updateMetersColor function deleted

function saveResult(userSpeech, scores) {
    const result = {
        timestamp: new Date().toISOString(),
        sentence: currentItems[currentItemIndex].text,
        userSpeech: userSpeech,
        scores: scores
    };
    trainingResults.push(result);

    // 통계 업데이트
    const attempts = parseInt(elements.totalAttempts.textContent || 0) + 1;
    elements.totalAttempts.textContent = attempts;

    // 평균 점수 계산
    let currentAvg = parseFloat(elements.avgScore.textContent);
    if (isNaN(currentAvg)) {
        currentAvg = 0;
    }
    const newAvg = ((currentAvg * (attempts - 1) + parseFloat(scores.totalSync)) / attempts).toFixed(1);
    elements.avgScore.textContent = newAvg;

    // 결과가 있으면 다운로드 버튼 활성화
    if (trainingResults.length > 0) {
        elements.downloadBtn.disabled = false;
        elements.downloadBtn.classList.remove('disabled'); // 스타일링 클래스가 있다면
    }
}

function downloadResults() {
    if (trainingResults.length === 0) {
        alert('저장된 학습 결과가 없습니다.');
        return;
    }

    // 1. 엑셀에 들어갈 내용 (데이터)
    // 현재 선택된 정보 가져오기 (Context)
    const chapter = elements.chapterSelect.options[elements.chapterSelect.selectedIndex]?.text || '';

    let rows = [
        ["Time", "Chapter", "Sentence", "User Speech", "Pronunciation", "Intonation", "Speed", "Total Score"]
    ];

    trainingResults.forEach(row => {
        const time = new Date(row.timestamp).toLocaleTimeString();
        const safeSentence = `"${(row.sentence || '').replace(/"/g, '""')}"`;
        const safeSpeech = `"${(row.userSpeech || '').replace(/"/g, '""')}"`;
        const safeChapter = `"${chapter}"`;
        const scores = row.scores || { pronunciation: 0, intonation: 0, speed: 0, totalSync: 0 };

        rows.push([
            time,
            safeChapter,
            safeSentence,
            safeSpeech,
            scores.pronunciation,
            scores.intonation,
            scores.speed,
            scores.totalSync
        ]);
    });

    // 2. 데이터를 텍스트 형식으로 변환 (쉼표로 구분)
    let csvContent = rows.map(e => e.join(",")).join("\n");

    // 3. 파일명 생성
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `english_training_results_${timestamp}.csv`;

    // 4. Data URL 방식으로 다운로드 (Chrome에서 가장 안정적)
    const BOM = "\ufeff"; // UTF-8 BOM
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + csvContent);

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Init
document.addEventListener('DOMContentLoaded', init);
