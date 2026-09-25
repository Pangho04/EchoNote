Pod::Spec.new do |s|
  s.name = 'VoiceRecorder'
  s.version = '0.0.1'
  s.summary = 'Voice processing recorder spike'
  s.author = ''
  s.homepage = 'https://example.invalid'
  s.license = 'UNLICENSED'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
