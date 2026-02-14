class Agentctl < Formula
  desc "Multi-account AI agent manager with TUI dashboard"
  homepage "https://github.com/ylcn91/agentctl"
  version "0.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/ylcn91/agentctl/releases/download/v#{version}/actl-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/ylcn91/agentctl/releases/download/v#{version}/actl-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  on_linux do
    url "https://github.com/ylcn91/agentctl/releases/download/v#{version}/actl-linux-x64.tar.gz"
    sha256 "PLACEHOLDER"
  end

  def install
    bin.install "actl"
    bin.install_symlink "actl" => "agentctl"
  end

  test do
    assert_match "agentctl", shell_output("#{bin}/actl --help")
  end
end
