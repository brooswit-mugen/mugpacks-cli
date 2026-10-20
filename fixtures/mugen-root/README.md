Fixture "existing basic M.U.G.E.N. directory" per the CLI contract's
`installDir` parameter (MUGEN-5 comment 49028). Copy this whole directory to
a throwaway location before each test run; never run a test against this
checked-in copy directly, so pre-existing-content assertions stay meaningful
across repeated test runs.
