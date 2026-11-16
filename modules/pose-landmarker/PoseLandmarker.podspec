require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "PoseLandmarker"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/UsmanMuzaffar0/excercise-tracker"
  s.license      = "UNLICENSED"
  s.authors      = "Exercise Tracker"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/UsmanMuzaffar0/excercise-tracker.git", :tag => "#{s.version}" }

  s.source_files = ["ios/**/*.{swift}", "ios/**/*.{m,mm}", "cpp/**/*.{hpp,cpp}"]

  # Models are fetched by scripts/fetch-models.mjs (postinstall) into models/.
  s.resource_bundles = { "PoseLandmarkerModels" => ["models/*.task"] }

  s.frameworks = ["AVFoundation", "CoreMedia", "UIKit"]

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  s.dependency "VisionCamera"
  s.dependency "MediaPipeTasksVision", "~> 1.0"

  load "nitrogen/generated/ios/PoseLandmarker+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
