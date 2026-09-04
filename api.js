/**
 * HeartRoute Client API & Hybrid Engine
 * 1. Supabase Cloud Database & Auth mode (active when Supabase URL & Key are provided)
 * 2. In-Browser Multi-Account DB fallback (active when offline or without Supabase config)
 */
var HeartAPI = window.HeartAPI || (() => {
  const STORAGE_KEY_USER = 'hr_current_user';
  const STORAGE_KEY_OFFLINE_DB = 'hr_offline_db';
  const STORAGE_KEY_SUPABASE = 'hr_supabase_config';

  // ============================================================================
  // Supabase Configuration & Client Management
  // ============================================================================
  function getSupabaseConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SUPABASE);
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return { url: '', key: '' };
  }

  function saveSupabaseConfig(cfg) {
    if (cfg && cfg.url && cfg.key) {
      localStorage.setItem(STORAGE_KEY_SUPABASE, JSON.stringify({
        url: cfg.url.trim(),
        key: cfg.key.trim()
      }));
    } else {
      localStorage.removeItem(STORAGE_KEY_SUPABASE);
    }
  }

  let cachedSupabase = null;
  function getSupabaseClient() {
    if (cachedSupabase) return cachedSupabase;
    const cfg = getSupabaseConfig();
    if (cfg.url && cfg.key && window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        cachedSupabase = window.supabase.createClient(cfg.url, cfg.key);
        return cachedSupabase;
      } catch (e) {
        console.warn('Supabase 초기화 실패, 오프라인 모드로 전환:', e);
      }
    }
    return null;
  }

  function isSupabaseConnected() {
    return !!getSupabaseClient();
  }

  // ============================================================================
  // In-Browser Multi-Account DB (Offline Mock Database)
  // ============================================================================
  function getOfflineDB() {
    let raw = localStorage.getItem(STORAGE_KEY_OFFLINE_DB);
    if (!raw) {
      const defaultData = {
        users: [
          { id: 1, email: "yeju@heart.com", password: "password123", nickname: "예주", invite_code: "HR-1628", couple_id: 1 },
          { id: 2, email: "junho@heart.com", password: "password123", nickname: "준호", invite_code: "HR-9543", couple_id: 1 }
        ],
        couples: [
          { id: 1, user1_id: 1, user2_id: 2, start_date: "2025-01-16", title: "예주 ❤️ 준호의 로맨스" }
        ],
        bucket_items: [
          { id: 1, couple_id: 1, text: "봄날 벚꽃 만개한 서울숲 피크닉 도시락 먹기", completed: 1, created_by: "예주" },
          { id: 2, couple_id: 1, text: "서로를 위한 은반지 핸드메이드 공방 원데이클래스", completed: 1, created_by: "준호" },
          { id: 3, couple_id: 1, text: "노을 지는 한강에서 돗자리 펴고 한강라면 먹기", completed: 1, created_by: "예주" },
          { id: 4, couple_id: 1, text: "제주도 푸른 바다 드라이브 & 오션뷰 카페 가기", completed: 0, created_by: "준호" },
          { id: 5, couple_id: 1, text: "기념일에 서로에게 손편지 써서 타임캡슐 묻기", completed: 0, created_by: "예주" },
          { id: 6, couple_id: 1, text: "비 오는 날 아늑한 만화카페에서 하루 종일 뒹굴기", completed: 0, created_by: "준호" },
          { id: 7, couple_id: 1, text: "별빛 쏟아지는 밤 글램핑 불멍 마시멜로 굽기", completed: 0, created_by: "예주" }
        ],
        diaries: [
          { id: 1, couple_id: 1, date: "2025-05-01", place: "성수동 서울숲 봄 산책", rating: 5, memo: "날씨도 화창하고 너와 손잡고 걸어서 너무 행복했던 날!", image_data: "", created_by: "예주" }
        ],
        love_letters: [
          { id: 1, couple_id: 1, sender_name: "준호", message: "예주야 오늘도 수고 많았어, 주말에 맛있는 거 먹으러 가자! 💕", created_at: new Date().toISOString() }
        ]
      };
      localStorage.setItem(STORAGE_KEY_OFFLINE_DB, JSON.stringify(defaultData));
      return defaultData;
    }
    return JSON.parse(raw);
  }

  function saveOfflineDB(data) {
    localStorage.setItem(STORAGE_KEY_OFFLINE_DB, JSON.stringify(data));
  }

  // Current session management
  let currentUser = JSON.parse(localStorage.getItem(STORAGE_KEY_USER) || 'null');

  function getCurrentUser() {
    return currentUser;
  }

  function setCurrentUser(user) {
    currentUser = user;
    if (user) {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY_USER);
    }
  }

  // ============================================================================
  // Offline Request Router
  // ============================================================================
  function handleOfflineRequest(endpoint, options) {
    const db = getOfflineDB();
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};

    // Auth: Register
    if (endpoint === '/api/auth/register' && method === 'POST') {
      const { email, password, nickname } = body;
      let existing = db.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
      if (existing) {
        const { password: _, ...safeUser } = existing;
        return { user: safeUser };
      }
      const num = Math.floor(1000 + Math.random() * 9000);
      const newUser = {
        id: db.users.length ? Math.max(...db.users.map(u => u.id)) + 1 : 1,
        email: email || `${nickname || 'user'}@heart.com`,
        password: password || 'password123',
        nickname: nickname || '예주',
        invite_code: `HR-${num}`,
        couple_id: 1
      };
      db.users.push(newUser);
      saveOfflineDB(db);
      const { password: _, ...safeUser } = newUser;
      return { user: safeUser };
    }

    // Auth: Login
    if (endpoint === '/api/auth/login' && method === 'POST') {
      const { email, password } = body;
      let user = db.users.find(u => (u.email.toLowerCase() === (email || '').toLowerCase() || u.nickname === email));
      if (!user) {
        const nick = (email ? email.split('@')[0] : '') || '예주';
        const num = Math.floor(1000 + Math.random() * 9000);
        user = {
          id: db.users.length ? Math.max(...db.users.map(u => u.id)) + 1 : 1,
          email: (email && email.includes('@')) ? email : `${email || 'yeju'}@heart.com`,
          password: password || 'password123',
          nickname: nick,
          invite_code: `HR-${num}`,
          couple_id: 1
        };
        db.users.push(user);
        saveOfflineDB(db);
      }
      const { password: _, ...safeUser } = user;
      return { user: safeUser };
    }

    // Auth: Me
    if (endpoint === '/api/auth/me') {
      if (!currentUser) throw new Error('로그인이 필요합니다.');
      let user = db.users.find(u => u.id === currentUser.id);
      if (!user) {
        user = currentUser;
        user.couple_id = user.couple_id || 1;
        db.users.push(user);
      }
      let couple = db.couples.find(c => c.id === (user.couple_id || 1)) || db.couples[0] || {
        id: 1,
        user1_id: 1,
        user2_id: 2,
        start_date: "2025-01-16",
        title: "예주 ❤️ 준호의 로맨스"
      };
      const partnerId = couple.user1_id === user.id ? couple.user2_id : couple.user1_id;
      let pUser = db.users.find(u => u.id === partnerId);
      let partner = pUser ? { id: pUser.id, nickname: pUser.nickname, email: pUser.email } : {
        id: (user.nickname === '준호' ? 1 : 2),
        nickname: (user.nickname === '준호' ? '예주' : '준호'),
        email: (user.nickname === '준호' ? 'yeju@heart.com' : 'junho@heart.com')
      };
      return { user, couple, partner };
    }

    // Couple: Connect
    if (endpoint === '/api/couple/connect' && method === 'POST') {
      if (!currentUser) throw new Error('로그인이 필요합니다.');
      let me = db.users.find(u => u.id === currentUser.id);
      if (!me) {
        me = { id: currentUser.id, nickname: currentUser.nickname || '나', email: currentUser.email || '', invite_code: currentUser.invite_code || 'HR-1628', couple_id: null };
        db.users.push(me);
      }

      let raw = (body.partnerCode || '').toString().trim().toUpperCase().replace(/\s+/g, '');
      if (!raw) throw new Error('상대방의 초대 코드를 입력해주세요.');

      let standardCode = raw;
      if (!standardCode.startsWith('HR-')) {
        if (standardCode.startsWith('HR')) {
          standardCode = 'HR-' + standardCode.slice(2);
        } else {
          standardCode = 'HR-' + standardCode;
        }
      }

      const partner = db.users.find(u => u.invite_code === standardCode);
      if (!partner) {
        throw new Error(`초대 코드(${standardCode})를 가진 사용자를 찾을 수 없습니다.`);
      }
      if (partner.id === me.id) {
        throw new Error('자신의 초대 코드는 입력할 수 없습니다.');
      }

      let couple = null;
      if (partner.couple_id) {
        couple = db.couples.find(c => c.id === partner.couple_id);
        if (couple) {
          couple.user2_id = me.id;
          me.couple_id = couple.id;
        }
      }

      if (!couple) {
        const newCouple = {
          id: db.couples.length ? Math.max(...db.couples.map(c => c.id)) + 1 : 1,
          user1_id: partner.id,
          user2_id: me.id,
          start_date: "2025-01-16",
          title: `${partner.nickname} ❤️ ${me.nickname}의 로맨스`
        };
        db.couples.push(newCouple);
        partner.couple_id = newCouple.id;
        me.couple_id = newCouple.id;
        couple = newCouple;
      }

      saveOfflineDB(db);
      currentUser.couple_id = couple.id;
      saveOfflineDB(db);
      setCurrentUser(me);
      return { couple, partner: { id: partner.id, nickname: partner.nickname, email: partner.email } };
    }

    // Couple: Settings
    if (endpoint === '/api/couple/settings' && method === 'PUT') {
      if (!currentUser) throw new Error('로그인이 필요합니다.');
      let me = db.users.find(u => u.id === currentUser.id);
      if (!me) me = currentUser;
      let couple = db.couples.find(c => c.id === (me.couple_id || 1));
      if (!couple) {
        couple = { id: 1, user1_id: 1, user2_id: 2, start_date: "2025-01-16", title: "예주 ❤️ 준호의 로맨스" };
        db.couples.push(couple);
      }
      if (body.start_date) couple.start_date = body.start_date;
      if (body.title) couple.title = body.title;
      if (body.myNickname) me.nickname = body.myNickname;
      if (body.partnerNickname) {
        const partnerId = couple.user1_id === me.id ? couple.user2_id : couple.user1_id;
        const partner = db.users.find(u => u.id === partnerId);
        if (partner) partner.nickname = body.partnerNickname;
      }
      saveOfflineDB(db);
      return { couple };
    }

    // Bucket list
    if (endpoint === '/api/bucket') {
      if (method === 'GET') {
        return (db.bucket_items || []).filter(b => b.couple_id === (currentUser.couple_id || 1));
      }
      if (method === 'POST') {
        const newItem = {
          id: Date.now(),
          couple_id: currentUser.couple_id || 1,
          text: body.text,
          completed: 0,
          created_by: currentUser.nickname
        };
        db.bucket_items.unshift(newItem);
        saveOfflineDB(db);
        return newItem;
      }
    }

    if (endpoint.startsWith('/api/bucket/') && method === 'PUT') {
      const id = parseInt(endpoint.split('/').pop(), 10);
      const item = db.bucket_items.find(b => b.id === id);
      if (item) item.completed = item.completed ? 0 : 1;
      saveOfflineDB(db);
      return item;
    }

    if (endpoint.startsWith('/api/bucket/') && method === 'DELETE') {
      const id = parseInt(endpoint.split('/').pop(), 10);
      db.bucket_items = db.bucket_items.filter(b => b.id !== id);
      saveOfflineDB(db);
      return { success: true };
    }

    // Diary
    if (endpoint === '/api/diary') {
      if (method === 'GET') {
        return (db.diaries || []).filter(d => d.couple_id === (currentUser.couple_id || 1));
      }
      if (method === 'POST') {
        const newDiary = {
          id: Date.now(),
          couple_id: currentUser.couple_id || 1,
          date: body.date,
          place: body.place,
          rating: body.rating,
          memo: body.memo,
          image_data: body.image_data || '',
          created_by: currentUser.nickname
        };
        db.diaries.unshift(newDiary);
        saveOfflineDB(db);
        return newDiary;
      }
    }

    // Love Letters
    if (endpoint === '/api/letters') {
      if (method === 'GET') {
        return (db.love_letters || []).filter(l => l.couple_id === (currentUser.couple_id || 1));
      }
      if (method === 'POST') {
        const newLetter = {
          id: Date.now(),
          couple_id: currentUser.couple_id || 1,
          sender_name: currentUser.nickname || '연인',
          message: body.message,
          created_at: new Date().toISOString()
        };
        if (!db.love_letters) db.love_letters = [];
        db.love_letters.unshift(newLetter);
        saveOfflineDB(db);
        return newLetter;
      }
    }

    return {};
  }

  // ============================================================================
  // Hybrid Unified API Interface (Supabase Cloud or Offline Router)
  // ============================================================================
  return {
    getCurrentUser,
    setCurrentUser,
    getSupabaseConfig,
    saveSupabaseConfig,
    isSupabaseConnected,

    // 1. 회원가입
    register: async (data) => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: authData, error } = await sb.auth.signUp({
          email: data.email,
          password: data.password,
          options: { data: { nickname: data.nickname } }
        });
        if (error) throw error;
        const user = authData.user;
        if (!user) throw new Error('회원가입 결과를 가져올 수 없습니다.');

        // 프로필 정보 조회
        let profile = null;
        for (let i = 0; i < 5; i++) {
          const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).single();
          if (p) { profile = p; break; }
          await new Promise(r => setTimeout(r, 300));
        }

        const safeUser = profile || {
          id: user.id,
          email: user.email,
          nickname: data.nickname,
          invite_code: 'HR-1628',
          couple_id: null
        };
        setCurrentUser(safeUser);
        return { user: safeUser };
      }
      return handleOfflineRequest('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
    },

    // 2. 로그인
    login: async (data) => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: authData, error } = await sb.auth.signInWithPassword({
          email: data.email,
          password: data.password
        });
        if (error) throw error;
        const user = authData.user;
        const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
        const safeUser = profile || {
          id: user.id,
          email: user.email,
          nickname: (profile && profile.nickname) || '연인',
          invite_code: (profile && profile.invite_code) || 'HR-1628',
          couple_id: profile ? profile.couple_id : null
        };
        setCurrentUser(safeUser);
        return { user: safeUser };
      }
      return handleOfflineRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
    },

    // 3. 커플 대시보드 상태 조회
    getDashboard: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const user = getCurrentUser();
        if (!user) return { couple: null, partner: null };

        const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
        if (!profile || !profile.couple_id) {
          return { couple: null, partner: null };
        }

        const { data: couple } = await sb.from('couples').select('*').eq('id', profile.couple_id).single();
        let partner = null;
        if (couple) {
          const partnerId = couple.user1_id === user.id ? couple.user2_id : couple.user1_id;
          if (partnerId) {
            const { data: pUser } = await sb.from('profiles').select('id, nickname, email, invite_code').eq('id', partnerId).single();
            partner = pUser;
          }
        }
        return { couple, partner };
      }
      return handleOfflineRequest('/api/auth/me', { method: 'GET' });
    },

    // 4. 초대 코드로 커플 연결
    connectCouple: async (partnerCode) => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb.rpc('connect_couple_by_code', { partner_code: partnerCode });
        if (error) throw error;
        // 프로필 갱신
        const me = getCurrentUser();
        if (me && data && data.id) {
          me.couple_id = data.id;
          setCurrentUser(me);
        }
        return { couple: data };
      }
      return handleOfflineRequest('/api/couple/connect', { method: 'POST', body: JSON.stringify({ partnerCode }) });
    },

    // 5. 커플 연결 해제
    disconnectCouple: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        if (me) {
          await sb.from('profiles').update({ couple_id: null }).eq('id', me.id);
          me.couple_id = null;
          setCurrentUser(me);
        }
        return { success: true };
      }
      const me = getCurrentUser();
      if (me) {
        me.couple_id = null;
        setCurrentUser(me);
      }
      return { success: true };
    },

    // 6. 커플 설정(이름/기념일) 저장
    updateCoupleSettings: async (data) => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        if (me && me.couple_id) {
          if (data.start_date || data.title) {
            await sb.from('couples').update({
              start_date: data.start_date,
              title: data.title
            }).eq('id', me.couple_id);
          }
          if (data.myNickname) {
            await sb.from('profiles').update({ nickname: data.myNickname }).eq('id', me.id);
            me.nickname = data.myNickname;
            setCurrentUser(me);
          }
        }
        return { success: true };
      }
      return handleOfflineRequest('/api/couple/settings', { method: 'PUT', body: JSON.stringify(data) });
    },

    // 7. 버킷리스트 (커플별 분리 조회 & 추가 & 삭제)
    getBuckets: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        if (!me || !me.couple_id) return [];
        const { data, error } = await sb.from('bucket_items')
          .select('*')
          .eq('couple_id', me.couple_id)
          .order('id', { ascending: false });
        if (error) { console.error(error); return []; }
        return data || [];
      }
      return handleOfflineRequest('/api/bucket', { method: 'GET' });
    },

    addBucket: async (text) => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        const { data, error } = await sb.from('bucket_items').insert([{
          couple_id: me.couple_id,
          text,
          completed: false,
          created_by: me.id
        }]).select().single();
        if (error) throw error;
        return data;
      }
      return handleOfflineRequest('/api/bucket', { method: 'POST', body: JSON.stringify({ text }) });
    },

    toggleBucket: async (id) => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: item } = await sb.from('bucket_items').select('completed').eq('id', id).single();
        if (item) {
          const nextState = !item.completed;
          await sb.from('bucket_items').update({ completed: nextState }).eq('id', id);
        }
        return { success: true };
      }
      return handleOfflineRequest(`/api/bucket/${id}`, { method: 'PUT' });
    },

    deleteBucket: async (id) => {
      const sb = getSupabaseClient();
      if (sb) {
        await sb.from('bucket_items').delete().eq('id', id);
        return { success: true };
      }
      return handleOfflineRequest(`/api/bucket/${id}`, { method: 'DELETE' });
    },

    // 8. 추억 다이어리 (커플별 분리 조회 & 추가)
    getDiaries: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        if (!me || !me.couple_id) return [];
        const { data, error } = await sb.from('diaries')
          .select('*')
          .eq('couple_id', me.couple_id)
          .order('date', { ascending: false });
        if (error) { console.error(error); return []; }
        return (data || []).map(d => ({ ...d, image_data: d.image_url }));
      }
      return handleOfflineRequest('/api/diary', { method: 'GET' });
    },

    addDiary: async (data) => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        const { data: newRow, error } = await sb.from('diaries').insert([{
          couple_id: me.couple_id,
          date: data.date,
          place: data.place,
          rating: parseInt(data.rating, 10) || 5,
          memo: data.memo,
          image_url: data.image_data || '',
          created_by: me.id
        }]).select().single();
        if (error) throw error;
        return { ...newRow, image_data: newRow.image_url };
      }
      return handleOfflineRequest('/api/diary', { method: 'POST', body: JSON.stringify(data) });
    },

    // 9. 비밀 쪽지함 (커플별 분리 조회 & 추가)
    getLetters: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        if (!me || !me.couple_id) return [];
        const { data, error } = await sb.from('letters')
          .select('*')
          .eq('couple_id', me.couple_id)
          .order('created_at', { ascending: false });
        if (error) { console.error(error); return []; }
        return data || [];
      }
      return handleOfflineRequest('/api/letters', { method: 'GET' });
    },

    addLetter: async (message) => {
      const sb = getSupabaseClient();
      if (sb) {
        const me = getCurrentUser();
        const { data: newRow, error } = await sb.from('letters').insert([{
          couple_id: me.couple_id,
          sender_id: me.id,
          sender_name: me.nickname || '연인',
          message
        }]).select().single();
        if (error) throw error;
        return newRow;
      }
      return handleOfflineRequest('/api/letters', { method: 'POST', body: JSON.stringify({ message }) });
    }
  };
})();
