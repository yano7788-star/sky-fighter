// 게임 이름·문구는 여기 한 곳에서 관리한다.
// 이름을 바꿀 때는 이 파일 + index.html <title> + public/manifest.webmanifest 의 name/short_name 3곳만 고치면 된다.
export const TITLE_LINES = ['SKY', 'BREAKER'] as const;   // 타이틀 화면에 줄 단위로 표시
export const SUBTITLE = 'NEON STRIKE';
export const TAGLINE = '하늘을 가르고, 우주의 끝에서 심판자를 쓰러뜨려라';
export const VERSION = 'v2.0';
