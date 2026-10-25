// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SaarthiProof
 * @notice On-chain Proof-of-Arbitrage registry for Saarthi.
 *         Every time Saarthi finds a cheaper basket split across
 *         Indian dark stores, the result hash is written here —
 *         making price intelligence permanently verifiable.
 *
 *         Also mints $SAARTHI ERC-20 cashback tokens when savings
 *         exceed a minimum threshold.
 */

interface IERC20Mint {
    function mint(address to, uint256 amount) external;
}

contract SaarthiProof {

    // ── Events ────────────────────────────────────────────────────────────────

    event ArbitrageProof(
        bytes32 indexed proofHash,
        address indexed user,
        uint256 savingsInr,   // savings in paise (INR × 100)
        uint256 timestamp,
        string  ipfsCid       // IPFS CID of the full receipt JSON
    );

    event WalletLinked(address indexed wallet, string pincode);

    // ── Storage ───────────────────────────────────────────────────────────────

    address public owner;
    address public tokenContract;   // $SAARTHI ERC-20 address (set after deploy)
    uint256 public totalProofs;
    uint256 public totalSavingsInr; // cumulative paise saved across all users

    mapping(bytes32 => bool)    public proofExists;
    mapping(address => uint256) public userProofCount;
    mapping(address => uint256) public userSavingsInr;
    mapping(address => string)  public walletPincode;  // Web3 identity → delivery zone

    uint256 public constant MIN_SAVINGS_FOR_REWARD = 100; // 100 paise = ₹1 minimum

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Record an on-chain Proof-of-Arbitrage.
     * @param proofHash  keccak256 of (user, items, stores, prices, timestamp)
     * @param user       wallet address of the shopper
     * @param savingsInr savings in paise (e.g. ₹120 = 12000 paise)
     * @param ipfsCid    IPFS CID of the full basket receipt JSON
     */
    function recordProof(
        bytes32 proofHash,
        address user,
        uint256 savingsInr,
        string calldata ipfsCid
    ) external onlyOwner {
        require(!proofExists[proofHash], "Proof already recorded");

        proofExists[proofHash] = true;
        totalProofs += 1;
        totalSavingsInr += savingsInr;
        userProofCount[user] += 1;
        userSavingsInr[user] += savingsInr;

        emit ArbitrageProof(proofHash, user, savingsInr, block.timestamp, ipfsCid);

        // Mint $SAARTHI tokens as cashback: 1 token per ₹10 saved
        if (tokenContract != address(0) && savingsInr >= MIN_SAVINGS_FOR_REWARD) {
            uint256 tokensToMint = (savingsInr / 1000) * 1e18; // 1 token per ₹10
            if (tokensToMint > 0) {
                IERC20Mint(tokenContract).mint(user, tokensToMint);
            }
        }
    }

    /**
     * @notice Link a wallet address to a delivery pincode.
     *         Replaces the Web2 phone+name profile with Web3 identity.
     */
    function linkWallet(string calldata pincode) external {
        walletPincode[msg.sender] = pincode;
        emit WalletLinked(msg.sender, pincode);
    }

    /**
     * @notice Set the $SAARTHI token contract address (called once after token deploy).
     */
    function setTokenContract(address _token) external onlyOwner {
        tokenContract = _token;
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function getStats() external view returns (
        uint256 _totalProofs,
        uint256 _totalSavingsInr,
        address _owner,
        address _tokenContract
    ) {
        return (totalProofs, totalSavingsInr, owner, tokenContract);
    }

    function getUserStats(address user) external view returns (
        uint256 proofCount,
        uint256 savingsInr,
        string memory pincode
    ) {
        return (userProofCount[user], userSavingsInr[user], walletPincode[user]);
    }
}
