# 장르 설정 프로파일 (Genre Profiles)

> **상태: Fallback Only**
>
> 고빈도 장르의 주요 판정·주조성·주금기 사항은 Story Contracts / CSV route seed로 이전되었습니다.
> 이 파일은 계약이 없거나, 프로젝트가 업그레이드되지 않았거나, 명시적 fallback 시에만 보조 프롬프트를 제공합니다.
>
> **역할**: 이 문서는 각 장르의 추독력 설정 파라미터를 정의하며, Step 1.5 / Context Agent / Checkers가 읽어 사용합니다.
>
> **원칙**: 설정은 "가중치와 제안 조정"에 사용되며, 강제 판정은 하지 않습니다.
>
> **설명**: xslca.cc 인기 순위 실증 데이터를 기반으로 확장하였으며, history-travel / game-lit을 신규 추가하고 shuangwen / xianxia / urban-power의 주요 파라미터를 업데이트하였습니다.

---

## 1. Profile 필드 설명

### 1.1 핵심 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 장르 고유 식별자 (영문 소문자) |
| `name` | string | 장르 한국어명 |
| `description` | string | 핵심 매력 포인트 한 줄 요약 |
| `tags` | string[] | 중첩 가능한 장르 태그 (다중 태그 확장 예약) |

### 1.2 훅 설정 (hook_config)

| 필드 | 타입 | 설명 |
|------|------|------|
| `preferred_types` | string[] | 선호 훅 유형 (우선순위 순) |
| `strength_baseline` | string | 기본 훅 강도: strong/medium/weak |
| `chapter_end_required` | boolean | 화말 훅 선호 여부 (true=강한 선호, 화별 강제 아님) |
| `transition_allowance` | number | 전환화 면제 상한 (연속 몇 화까지 등급 하향 허용) |

### 1.3 사이다 설정 (coolpoint_config)

| 필드 | 타입 | 설명 |
|------|------|------|
| `preferred_patterns` | string[] | 선호 사이다 패턴 (우선순위 순) |
| `density_per_chapter` | string | 화당 사이다 밀도: high(2+)/medium(1)/low(0-1) |
| `combo_interval` | number | 콤보 사이다 권장 간격 (N화마다 1개 참고) |
| `milestone_interval` | number | 단계별 승리 권장 간격 (N화마다 1개 참고) |

### 1.4 마이크로 사이다 설정 (micropayoff_config)

| 필드 | 타입 | 설명 |
|------|------|------|
| `preferred_types` | string[] | 선호 마이크로 사이다 유형 |
| `min_per_chapter` | number | 화당 권장 마이크로 사이다 최솟값 |
| `transition_min` | number | 전환화 권장 마이크로 사이다 최솟값 |

### 1.5 페이스 레드라인 (pacing_config)

| 필드 | 타입 | 설명 |
|------|------|------|
| `stagnation_threshold` | number | 페이스 정체 임계값 (연속 N화 진행 없음=HARD-003) |
| `strand_quest_max` | number | Quest 본선 최대 연속 화수 |
| `strand_fire_gap_max` | number | Fire 감정선 최대 단절 화수 |
| `transition_max_consecutive` | number | 전환화 최대 연속 수 |

### 1.6 제약 면제 (override_config)

| 필드 | 타입 | 설명 |
|------|------|------|
| `allowed_rationale_types` | string[] | 허용되는 Override 사유 유형 |
| `debt_multiplier` | number | 부채 배율 (>1이면 해당 장르가 더 엄격) |
| `payback_window_default` | number | 기본 상환 윈도우 (화수) |

---

## 2. 내장 장르 Profiles

### 2.1 사이다/시스템 (shuangwen)

```yaml
id: shuangwen
name: 사이다/시스템
description: 치트키로 무한 성장, 빠른 페이스 레벨업, 과시·응징 풀코스
tags: [shuangwen]

hook_config:
  preferred_types: [渴望钩, 危机钩, 情绪钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [装逼打脸, 扮猪吃虎, 越级反杀, 迪化误解]
  density_per_chapter: high
  combo_interval: 5
  milestone_interval: 10

micropayoff_config:
  preferred_types: [能力兑现, 资源兑现, 认可兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 5
  strand_fire_gap_max: 15
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, ARC_TIMING]
  debt_multiplier: 1.0
  payback_window_default: 3
```

**장르 특징**:
- 고밀도 사이다를 추구하며, 독자는 빠른 페이스를 기대함
- 화말에는 명확한 기대감 유지 권장 (돌파 직전/응징 직전/한몫 잡을 예감)
- 전환화 허용도 낮음, 연속 2화를 초과하지 않도록 권장
- 수치 피드백은 시각화 권장 (전투력 50 → 전투력 180, 전후 비교)
- 치트키는 상한/소모/쿨다운 설정 권장, 무제한 사용 방지

---

### 2.2 선협/동양판타지 (xianxia)

```yaml
id: xianxia
name: 선협/동양판타지
description: 운명을 거스르는 수련, 냉혹한 법칙, 기연과 쟁투의 공존
tags: [xianxia]

hook_config:
  preferred_types: [危机钩, 渴望钩, 选择钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 3

coolpoint_config:
  preferred_patterns: [越级反杀, 扮猪吃虎, 身份掉马, 反派翻车]
  density_per_chapter: high
  combo_interval: 5
  milestone_interval: 15

micropayoff_config:
  preferred_types: [能力兑现, 资源兑现, 信息兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 4
  strand_quest_max: 6
  strand_fire_gap_max: 12
  transition_max_consecutive: 3

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, WORLD_RULE_CONSTRAINT, ARC_TIMING]
  debt_multiplier: 0.9
  payback_window_default: 5
```

**장르 특징**:
- 세계관 구축이 필요하며, 더 많은 복선 화수를 허용함
- 경지 돌파는 핵심 기대 요소로, 단계 체계 시각화 권장 (8-10단계 체계, 전후 수치 비교)
- 자원 화폐 체계 (영석/단약/공법)는 핵심 마이크로 사이다 수단
- 설정 제약은 합리적 Override 사유로 사용 가능

---

### 2.3 로맨스/달달물 (romance)

```yaml
id: romance
name: 로맨스/달달물
description: 감정 교류, 관계 진전, 설렘과 고구마가 교차
tags: [romance]

hook_config:
  preferred_types: [情绪钩, 渴望钩, 选择钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [甜蜜超预期, 身份掉马, 迪化误解]
  density_per_chapter: medium
  combo_interval: 6
  milestone_interval: 12

micropayoff_config:
  preferred_types: [关系兑现, 情绪兑现, 认可兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 4
  strand_quest_max: 4
  strand_fire_gap_max: 5
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, CHARACTER_CREDIBILITY, ARC_TIMING]
  debt_multiplier: 1.0
  payback_window_default: 4
```

**장르 특징**:
- 감정선이 절대적 핵심이며, 단절 허용도가 극히 낮음
- 감정 훅이 최강 카드 (안쓰러움/설렘/질투)
- 관계 진전이 가장 중요한 마이크로 사이다

---

### 2.4 미스터리/추리 (mystery)

```yaml
id: mystery
name: 미스터리/추리
description: 수수께끼 중심 전개, 논리적 추론, 진실의 단계적 공개
tags: [mystery]

hook_config:
  preferred_types: [悬念钩, 危机钩, 选择钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [反派翻车, 身份掉马]
  density_per_chapter: low
  combo_interval: 10
  milestone_interval: 20

micropayoff_config:
  preferred_types: [信息兑现, 线索兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 8
  strand_fire_gap_max: 20
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [LOGIC_INTEGRITY, TRANSITIONAL_SETUP, ARC_TIMING]
  debt_multiplier: 0.8
  payback_window_default: 5
```

**장르 특징**:
- 논리적 완결성이 사이다 밀도보다 우선
- 정보 마이크로 사이다가 핵심 (지속적인 단서 진행 유지 권장)
- LOGIC_INTEGRITY는 훅 강도 하향의 합리적 사유로 사용 가능

---

### 2.5 규칙 괴담 (rules-mystery)

```yaml
id: rules-mystery
name: 규칙 괴담
description: 기괴한 규칙, 생존 추리, 괴담을 역이용한 반격
tags: [rules-mystery, horror]

hook_config:
  preferred_types: [危机钩, 悬念钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 1

coolpoint_config:
  preferred_patterns: [越级反杀, 反派翻车]
  density_per_chapter: medium
  combo_interval: 5
  milestone_interval: 8

micropayoff_config:
  preferred_types: [信息兑现, 线索兑现, 能力兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 2
  strand_quest_max: 4
  strand_fire_gap_max: 15
  transition_max_consecutive: 1

override_config:
  allowed_rationale_types: [LOGIC_INTEGRITY, WORLD_RULE_CONSTRAINT]
  debt_multiplier: 1.2
  payback_window_default: 2
```

**장르 특징**:
- 긴장감 유지를 위해 높은 훅 강도 필요
- 전환화 허용도 극히 낮음 (1화)
- 규칙 제약은 합리적 Override 사유로 사용 가능

---

### 2.6 현대판타지/이능 (urban-power)

```yaml
id: urban-power
name: 현대판타지/이능
description: 현대 배경, 숨겨진 초능력, 조용한 과시, 산업 파워게임
tags: [urban, power, industry]

hook_config:
  preferred_types: [危机钩, 渴望钩, 情绪钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [扮猪吃虎, 装逼打脸, 身份掉马, 迪化误解]
  density_per_chapter: high
  combo_interval: 3
  milestone_interval: 10

micropayoff_config:
  preferred_types: [认可兑现, 能力兑现, 关系兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 5
  strand_fire_gap_max: 8
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, ARC_TIMING]
  debt_multiplier: 1.0
  payback_window_default: 3
```

**장르 특징**:
- 과시와 응징 시리즈가 핵심 사이다
- 현대 배경 특성상 신분 숨기기 → 정체 공개의 페이스 조율 필요
- 사회적 지위 변화가 중요한 마이크로 사이다
- 연예계/산업 배경이 인기이며, 감정선 비중 높음 (단절 허용도 8화로 감소)
- 3화 1피크 리듬: 1화 위기, 2화 능력 첫 발휘, 3화 소규모 승리+새 장애물

---

### 2.7 단편 (zhihu-short)

```yaml
id: zhihu-short
name: 단편
description: 빠르고 강렬한 반전, 강한 감정 충격
tags: [short, zhihu]

hook_config:
  preferred_types: [情绪钩, 悬念钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 0

coolpoint_config:
  preferred_patterns: [反派翻车, 身份掉马, 甜蜜超预期]
  density_per_chapter: high
  combo_interval: 2
  milestone_interval: 3

micropayoff_config:
  preferred_types: [情绪兑现, 信息兑现, 关系兑现]
  min_per_chapter: 2
  transition_min: 2

pacing_config:
  stagnation_threshold: 1
  strand_quest_max: 2
  strand_fire_gap_max: 3
  transition_max_consecutive: 0

override_config:
  allowed_rationale_types: []
  debt_multiplier: 2.0
  payback_window_default: 1
```

**장르 특징**:
- 전환화 허용 폭이 극히 좁으며, 화당 체감 가능한 수확이 최소 1개 이상 권장
- 매우 높은 훅 강도 요구
- 부채 배율 최고 (단편에서 장기 부채는 지양)

---

### 2.8 대역물/고구마 (substitute)

```yaml
id: substitute
name: 대역물/고구마
description: 감정 갈등, 오해와 반전, 매달리는 남주의 뒤늦은 뉘우침
tags: [substitute, angst]

hook_config:
  preferred_types: [情绪钩, 选择钩, 悬念钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [身份掉马, 反派翻车, 甜蜜超预期]
  density_per_chapter: medium
  combo_interval: 5
  milestone_interval: 10

micropayoff_config:
  preferred_types: [情绪兑现, 关系兑现, 认可兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 3
  strand_fire_gap_max: 4
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [CHARACTER_CREDIBILITY, ARC_TIMING, TRANSITIONAL_SETUP]
  debt_multiplier: 1.0
  payback_window_default: 4
```

**장르 특징**:
- 감정 훅이 절대적 핵심 (고구마→안쓰러움→기대감)
- 정체 공개가 최강 사이다
- 감정선 단절 허용도 극히 낮음

---

### 2.9 e스포츠 (esports)

```yaml
id: esports
name: e스포츠
description: 경기장 파워게임, 팀 호흡 맞추기, 역전극과 우승 추격
tags: [esports, competition]

hook_config:
  preferred_types: [危机钩, 选择钩, 渴望钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 1

coolpoint_config:
  preferred_patterns: [越级反杀, 反派翻车, 迪化误解]
  density_per_chapter: high
  combo_interval: 4
  milestone_interval: 8

micropayoff_config:
  preferred_types: [信息兑现, 认可兑现, 关系兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 2
  strand_quest_max: 4
  strand_fire_gap_max: 8
  transition_max_consecutive: 1

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, ARC_TIMING, LOGIC_INTEGRITY]
  debt_multiplier: 1.1
  payback_window_default: 2
```

**장르 특징**:
- 경기 화에는 추적 가능한 승패 목표와 결정 포인트 권장
- 역경/역전 상황이 핵심 사이다 원천
- 전환화 허용도 낮으며, 실시간 피드백 감각 유지 필요 (스코어/여론/컨디션)

---

### 2.10 방송물 (livestream)

```yaml
id: livestream
name: 방송물
description: 플랫폼 트래픽 파워게임, 실시간 피드백 중심, 여론과 비즈니스 투트랙 전개
tags: [livestream, urban]

hook_config:
  preferred_types: [危机钩, 情绪钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 1

coolpoint_config:
  preferred_patterns: [装逼打脸, 反派翻车, 身份掉马]
  density_per_chapter: high
  combo_interval: 3
  milestone_interval: 6

micropayoff_config:
  preferred_types: [认可兑现, 资源兑现, 信息兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 2
  strand_quest_max: 4
  strand_fire_gap_max: 6
  transition_max_consecutive: 1

override_config:
  allowed_rationale_types: [TRANSITIONAL_SETUP, ARC_TIMING, CHARACTER_CREDIBILITY]
  debt_multiplier: 1.1
  payback_window_default: 2
```

**장르 특징**:
- "외부 반응→주인공 반응→결과 변화"의 피드백 루프 우선 형성
- 여론 반전과 비즈니스 파워게임은 증거 체인에 기반해야 하며, 구호에 의존하면 안 됨
- 수치 변화 (시청자 수/순위/전환율)를 고빈도 마이크로 사이다로 활용 가능

---

### 2.11 코즈믹 호러 (cosmic-horror)

```yaml
id: cosmic-horror
name: 코즈믹 호러
description: 규칙 오염과 이성 붕괴의 병행, 진실에 다가갈수록 대가는 커진다
tags: [horror, mystery, cosmic]

hook_config:
  preferred_types: [悬念钩, 危机钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 1

coolpoint_config:
  preferred_patterns: [反派翻车, 迪化误解, 越级反杀]
  density_per_chapter: medium
  combo_interval: 6
  milestone_interval: 10

micropayoff_config:
  preferred_types: [线索兑现, 信息兑现, 情绪兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 2
  strand_quest_max: 4
  strand_fire_gap_max: 12
  transition_max_consecutive: 1

override_config:
  allowed_rationale_types: [LOGIC_INTEGRITY, WORLD_RULE_CONSTRAINT, ARC_TIMING]
  debt_multiplier: 1.3
  payback_window_default: 2
```

**장르 특징**:
- 공포감은 규칙과 대가에서 비롯되며, 단순 분위기 쌓기가 아님
- 진실을 진전시킬 때마다 명확한 손실 (이성/관계/자원)을 결부시켜야 함
- 강도 높은 훅은 "미결 규칙 문제"를 우선시하며, 단순 공포 자극은 지양

### 2.12 대체역사 (history-travel)

```yaml
id: history-travel
name: 대체역사
description: 현대의 영혼이 과거로 이동, 지식 우위로 역사를 바꾸고 입지를 키워 역전
tags: [history, travel, knowledge]

hook_config:
  preferred_types: [选择钩, 危机钩, 渴望钩]
  strength_baseline: medium
  chapter_end_required: true
  transition_allowance: 2

coolpoint_config:
  preferred_patterns: [打脸权威, 扮猪吃虎, 反派翻车, 身份掉马]
  density_per_chapter: medium
  combo_interval: 3
  milestone_interval: 10

micropayoff_config:
  preferred_types: [信息兑现, 资源兑现, 认可兑现]
  min_per_chapter: 1
  transition_min: 1

pacing_config:
  stagnation_threshold: 3
  strand_quest_max: 5
  strand_fire_gap_max: 10
  transition_max_consecutive: 2

override_config:
  allowed_rationale_types: [WORLD_RULE_CONSTRAINT, CHARACTER_CREDIBILITY, ARC_TIMING]
  debt_multiplier: 0.9
  payback_window_default: 4
```

**장르 특징**:
- 지식 우위 > 무력 우위, 추론 과정을 보여줘야 하며 결론만 제시해선 안 됨
- 3화 1피크 리듬: 1화 위기/이동, 2화 지식 첫 발휘, 3화 소규모 승리+새 장애물
- 반대 세력은 합리적 동기 보유 (이해관계 충돌), 권위 인물은 쉽게 설득되지 않음 (수차례 증명 필요)
- 역사에는 관성이 있으며, 하나를 바꾸면 연쇄 반응 유발 (비선형 결과)
- 여성 주인공 비율 상승, 내정/세력 키우기/업계 개혁 태그 인기

---

### 2.13 게임 (game-lit)

```yaml
id: game-lit
name: 게임
description: 게임화된 세계관, 시스템 치트키 중심, 수치 피드백의 사이다, 극한의 반차 시작점
tags: [game, system, apocalypse]

hook_config:
  preferred_types: [危机钩, 渴望钩, 选择钩]
  strength_baseline: strong
  chapter_end_required: true
  transition_allowance: 0

coolpoint_config:
  preferred_patterns: [越级反杀, 装逼打脸, 扮猪吃虎, 反派翻车]
  density_per_chapter: high
  combo_interval: 3
  milestone_interval: 10

micropayoff_config:
  preferred_types: [能力兑现, 资源兑现, 认可兑现]
  min_per_chapter: 2
  transition_min: 1

pacing_config:
  stagnation_threshold: 2
  strand_quest_max: 5
  strand_fire_gap_max: 15
  transition_max_consecutive: 0

override_config:
  allowed_rationale_types: [WORLD_RULE_CONSTRAINT, ARC_TIMING]
  debt_multiplier: 1.1
  payback_window_default: 2
```

**장르 특징**:
- 초반 화에서 치트키를 가능한 빨리 공개 권장 (보통 1-2화 이내)
- 수치 피드백 시각화 권장 (전투력 50 → 전투력 180, 전후 비교)
- 치트키는 상한/소모/쿨다운 설정 권장, 무제한 사용 방지
- 전환화 허용 폭이 매우 좁으며, "사이다 또는 수치 진행" 중 최소 하나 유지 권장
- IP 융합 (LOL/포켓몬 등)이 차별화 태그이며, 종말 생존계 부상
- 초반 (권장 3화 이내)에 명확한 적대 요소 등장 권장 (환경/규칙/구체적 반대 세력 중 택일)

---

## 3. Profile 로드 메커니즘

### 3.1 로드 시점

1. **Step 1.5**: `state.json → project.genre`에 따라 해당 profile 로드
2. **Context Agent**: profile 관련 필드를 창작 태스크 시트에 주입
3. **Checkers**: profile에 따라 감지 임계값 및 제안 가중치 조정

### 3.2 다중 태그 지원 (예약)

현재는 단일 태그 모드입니다. 향후 다중 태그 지원 시:
- `tags` 필드를 중첩 적용
- 충돌 필드는 더 엄격한 값 채택
- 예: `[romance, mystery]` → 감정선 단절 허용은 min(5, 20) = 5 적용

### 3.3 커스텀 Profile

사용자는 `state.json`에서 기본값을 덮어쓸 수 있습니다:

```json
{
  "project": {
    "genre": "xianxia",
    "genre_overrides": {
      "pacing_config": {
        "stagnation_threshold": 5
      }
    }
  }
}
```

---

## 4. Taxonomy와의 관계

| Taxonomy 정의 | Profile 설정 |
|--------------|-------------|
| 훅 유형 목록 | 어떤 유형을 선호하는가 |
| 사이다 패턴 목록 | 어떤 패턴을 선호하는가 |
| 마이크로 사이다 유형 목록 | 어떤 유형을 선호하는가 |
| Hard/Soft 기준 | 임계값 조정 |
| Override 사유 유형 | 어떤 사유를 허용하는가 |
