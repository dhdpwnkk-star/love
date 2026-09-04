-- ==============================================================================
-- HeartRoute Supabase Database Schema & RLS Policies
-- 설명: 커플 전용 데이터 격리(Isolation), 자동 프로필 생성, 초대 코드 기반 커플 매칭
-- 사용법: Supabase Dashboard -> SQL Editor 에 전체 복사 후 [RUN] 클릭
-- ==============================================================================

-- 1. UUID 확장 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 커플(couples) 테이블 생성
CREATE TABLE IF NOT EXISTS public.couples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user2_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    start_date DATE NOT NULL DEFAULT '2025-01-16',
    title TEXT NOT NULL DEFAULT '예주 ❤️ 준호의 로맨스',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. 회원 프로필(profiles) 테이블 생성
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    nickname TEXT NOT NULL DEFAULT '연인',
    invite_code VARCHAR(10) UNIQUE NOT NULL,
    couple_id UUID REFERENCES public.couples(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. 버킷리스트(bucket_items) 테이블 생성 (커플별 분리 저장)
CREATE TABLE IF NOT EXISTS public.bucket_items (
    id BIGSERIAL PRIMARY KEY,
    couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. 추억 다이어리(diaries) 테이블 생성 (커플별 분리 저장)
CREATE TABLE IF NOT EXISTS public.diaries (
    id BIGSERIAL PRIMARY KEY,
    couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    place TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
    memo TEXT,
    image_url TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. 비밀 쪽지함(letters) 테이블 생성 (커플별 분리 저장)
CREATE TABLE IF NOT EXISTS public.letters (
    id BIGSERIAL PRIMARY KEY,
    couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 7. 회원가입 시 프로필 및 고유 초대 코드 자동 생성 트리거
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    random_num INT;
    new_code TEXT;
    code_exists BOOLEAN;
    user_nick TEXT;
BEGIN
    user_nick := COALESCE(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1), '연인');

    -- 중복되지 않는 고유 초대 코드 (HR-XXXX) 생성
    LOOP
        random_num := floor(random() * 9000 + 1000)::INT;
        new_code := 'HR-' || random_num::TEXT;
        SELECT EXISTS(SELECT 1 FROM public.profiles WHERE invite_code = new_code) INTO code_exists;
        EXIT WHEN NOT code_exists;
    END LOOP;

    INSERT INTO public.profiles (id, email, nickname, invite_code)
    VALUES (new.id, new.email, user_nick, new_code);

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 8. 초대 코드로 1:1 커플 연결 RPC 함수
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.connect_couple_by_code(partner_code TEXT)
RETURNS JSON AS $$
DECLARE
    me_id UUID;
    my_nick TEXT;
    partner_row public.profiles%ROWTYPE;
    target_couple_id UUID;
    couple_row public.couples%ROWTYPE;
BEGIN
    me_id := auth.uid();
    IF me_id IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.';
    END IF;

    SELECT nickname INTO my_nick FROM public.profiles WHERE id = me_id;

    -- 대소문자 무시 및 공백 제거 표준화
    partner_code := upper(trim(partner_code));
    IF NOT partner_code LIKE 'HR-%' THEN
        IF partner_code LIKE 'HR%' THEN
            partner_code := 'HR-' || substring(partner_code from 3);
        ELSE
            partner_code := 'HR-' || partner_code;
        END IF;
    END IF;

    -- 상대방 프로필 찾기
    SELECT * INTO partner_row FROM public.profiles WHERE invite_code = partner_code;
    IF partner_row.id IS NULL THEN
        RAISE EXCEPTION '해당 초대 코드를 가진 사용자를 찾을 수 없습니다: %', partner_code;
    END IF;

    IF partner_row.id = me_id THEN
        RAISE EXCEPTION '자신의 초대 코드는 입력할 수 없습니다.';
    END IF;

    -- 기존 커플이 있는지 확인
    IF partner_row.couple_id IS NOT NULL THEN
        target_couple_id := partner_row.couple_id;
        SELECT * INTO couple_row FROM public.couples WHERE id = target_couple_id;

        -- 상대방 커플에 빈 슬롯이 있으면 참여
        IF couple_row.user2_id IS NULL AND couple_row.user1_id != me_id THEN
            UPDATE public.couples SET user2_id = me_id WHERE id = target_couple_id RETURNING * INTO couple_row;
        ELSIF couple_row.user1_id != me_id AND couple_row.user2_id != me_id THEN
            -- 새로운 커플방 생성
            INSERT INTO public.couples (user1_id, user2_id, title)
            VALUES (partner_row.id, me_id, partner_row.nickname || ' ❤️ ' || my_nick || '의 로맨스')
            RETURNING * INTO couple_row;
            target_couple_id := couple_row.id;
        END IF;
    ELSE
        -- 신규 커플 생성
        INSERT INTO public.couples (user1_id, user2_id, title)
        VALUES (partner_row.id, me_id, partner_row.nickname || ' ❤️ ' || my_nick || '의 로맨스')
        RETURNING * INTO couple_row;
        target_couple_id := couple_row.id;
    END IF;

    -- 양쪽 프로필에 couple_id 반영
    UPDATE public.profiles SET couple_id = target_couple_id WHERE id = me_id;
    UPDATE public.profiles SET couple_id = target_couple_id WHERE id = partner_row.id;

    RETURN row_to_json(couple_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 9. Row Level Security (RLS) 커플 데이터 분리 보안 정책
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;

-- profiles RLS: 인증된 사용자는 누구나 프로필 조회 가능(상대방 초대코드 검색용), 수정은 본인만
DROP POLICY IF EXISTS "Profiles read policy" ON public.profiles;
CREATE POLICY "Profiles read policy" ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
CREATE POLICY "Profiles update policy" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- couples RLS: 자신이 속한 커플만 조회 및 수정 가능
DROP POLICY IF EXISTS "Couples access policy" ON public.couples;
CREATE POLICY "Couples access policy" ON public.couples FOR ALL TO authenticated
USING (user1_id = auth.uid() OR user2_id = auth.uid());

-- helper 함수: 현재 사용자의 couple_id 가져오기
CREATE OR REPLACE FUNCTION public.get_my_couple_id()
RETURNS UUID AS $$
    SELECT couple_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- bucket_items RLS: 내 커플의 버킷리스트만 접근 가능
DROP POLICY IF EXISTS "Bucket items couple isolation" ON public.bucket_items;
CREATE POLICY "Bucket items couple isolation" ON public.bucket_items FOR ALL TO authenticated
USING (couple_id = public.get_my_couple_id())
WITH CHECK (couple_id = public.get_my_couple_id());

-- diaries RLS: 내 커플의 다이어리만 접근 가능
DROP POLICY IF EXISTS "Diaries couple isolation" ON public.diaries;
CREATE POLICY "Diaries couple isolation" ON public.diaries FOR ALL TO authenticated
USING (couple_id = public.get_my_couple_id())
WITH CHECK (couple_id = public.get_my_couple_id());

-- letters RLS: 내 커플의 쪽지만 접근 가능
DROP POLICY IF EXISTS "Letters couple isolation" ON public.letters;
CREATE POLICY "Letters couple isolation" ON public.letters FOR ALL TO authenticated
USING (couple_id = public.get_my_couple_id())
WITH CHECK (couple_id = public.get_my_couple_id());

-- 10. 기본 버킷리스트 아이템 자동 추가 함수
CREATE OR REPLACE FUNCTION public.seed_default_buckets(target_couple_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.bucket_items (couple_id, text, completed) VALUES
    (target_couple_id, '봄날 벚꽃 만개한 서울숲 피크닉 도시락 먹기', true),
    (target_couple_id, '서로를 위한 은반지 핸드메이드 공방 원데이클래스', true),
    (target_couple_id, '노을 지는 한강에서 돗자리 펴고 한강라면 먹기', true),
    (target_couple_id, '제주도 푸른 바다 드라이브 & 오션뷰 카페 가기', false),
    (target_couple_id, '기념일에 서로에게 손편지 써서 타임캡슐 묻기', false),
    (target_couple_id, '비 오는 날 아늑한 만화카페에서 하루 종일 뒹굴기', false),
    (target_couple_id, '별빛 쏟아지는 밤 글램핑 불멍 마시멜로 굽기', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
