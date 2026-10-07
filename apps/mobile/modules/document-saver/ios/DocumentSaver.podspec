Pod::Spec.new do |s|
  s.name = 'DocumentSaver'
  s.version = '0.0.1'
  s.summary = 'Save a file through the system document picker'
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
