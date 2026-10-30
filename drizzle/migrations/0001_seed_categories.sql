-- Initial categories. Administrators can add / rename / disable them later.
INSERT INTO `categories` (`slug`, `name`, `description`, `sort_order`) VALUES
  ('ai', 'AI', '人工知能・機械学習・生成AIなど', 10),
  ('programming', 'プログラミング', 'ソフトウェア開発・アプリ制作・競技プログラミングなど', 20),
  ('research', '研究・探究', '探究活動・課題研究・学術系イベント', 30),
  ('business', '起業・ビジネス', '起業・ビジネスコンテスト・アントレプレナーシップ', 40),
  ('design', 'デザイン', 'UI/UX・グラフィック・プロダクトデザインなど', 50),
  ('science', '科学・技術', '理科・数学・工学・ものづくりなど', 60),
  ('contest', 'コンテスト', 'コンテスト・ハッカソン・コンペティション', 70),
  ('study-session', '勉強会', '勉強会・講座・ワークショップ', 80),
  ('presentation', '発表会', '研究発表会・ポスター発表・ピッチ', 90),
  ('volunteer', 'ボランティア', 'ボランティア・地域活動・社会貢献', 100),
  ('other', 'その他', 'その他のイベント', 1000);
